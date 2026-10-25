import { createHash } from "node:crypto";
import { DateTime } from "luxon";
import { z } from "zod";
import { getShopDatabase } from "../../db.server";
import { decryptToken } from "./secrets.server";
import { calendarIntervals, calendarPage } from "./events";
import { BookingError } from "../bookings/validation";
const tokenCache = new Map<string, { token: string; expires: number }>();
export async function exchangeGoogleToken(parameters: Record<string, string>) {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) throw new Error("Google Calendar is not configured");
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", signal: AbortSignal.timeout(5000),
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, ...parameters }) });
  if (!response.ok) throw new BookingError("Reconnect Google Calendar to continue.", 503);
  return z.object({ access_token: z.string(), expires_in: z.number(), refresh_token: z.string().optional() }).parse(await response.json());
}
export async function calendarRequest(shopId: string, path: string, init: RequestInit = {}) {
  const shop = await getShopDatabase(shopId).shop.findUniqueOrThrow({ where: { id: shopId }, select: { googleRefreshToken: true } });
  if (!shop.googleRefreshToken) throw new BookingError("Reconnect Google Calendar to continue.", 503);
  const key = shopId + ":" + createHash("sha256").update(shop.googleRefreshToken).digest("hex");
  let cached = tokenCache.get(key);
  if (!cached || cached.expires <= DateTime.utc().toMillis()) {
    const result = await exchangeGoogleToken({ grant_type: "refresh_token", refresh_token: decryptToken(shop.googleRefreshToken) });
    cached = { token: result.access_token, expires: DateTime.utc().plus({ seconds: Math.max(1, result.expires_in - 60) }).toMillis() };
    if (tokenCache.size > 1000) tokenCache.clear();
    tokenCache.set(key, cached);
  }
  const response = await fetch("https://www.googleapis.com/calendar/v3/" + path, { ...init, signal: AbortSignal.timeout(5000),
    headers: { "Content-Type": "application/json", ...init.headers, Authorization: "Bearer " + cached.token } });
  if (response.status === 401 || response.status === 403) {
    tokenCache.delete(key); throw new BookingError("Reconnect Google Calendar to continue.", 503);
  }
  return response;
}
export async function googleBusyIntervals(shopId: string, calendarId: string, start: DateTime, end: DateTime) {
  const db = getShopDatabase(shopId);
  const known = await db.booking.findMany({ where: { status: { in: ["PENDING", "CONFIRMED"] }, startAt: { lt: end.toJSDate() }, endAt: { gt: start.toJSDate() } },
    select: { id: true, startAt: true, endAt: true } });
  const intervals = [];
  let nextPageToken: string | undefined;
  try {
    for (let page = 0; page < 3; page++) {
      const query = new URLSearchParams({ timeMin: start.toUTC().toISO()!, timeMax: end.toUTC().toISO()!, singleEvents: "true", maxResults: "2500",
        fields: "items(id,status,transparency,start,end,extendedProperties),nextPageToken,timeZone" });
      if (nextPageToken) query.set("pageToken", nextPageToken);
      const response = await calendarRequest(shopId, "calendars/" + encodeURIComponent(calendarId) + "/events?" + query);
      if (!response.ok) throw new Error("Calendar availability request failed");
      const result = calendarPage.parse(await response.json());
      intervals.push(...calendarIntervals(result, known));
      nextPageToken = result.nextPageToken;
      if (!nextPageToken) break;
    }
    if (nextPageToken) throw new Error("Calendar event limit exceeded");
    return intervals;
  } catch {
    await db.shop.update({ where: { id: shopId }, data: { googleSyncError: "Calendar availability could not be checked. Reconnect or try again." } });
    throw new BookingError("Calendar availability could not be verified. Please try again shortly.", 503);
  }
}
