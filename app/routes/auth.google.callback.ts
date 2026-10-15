import { DateTime } from "luxon";
import { z } from "zod";
import type { LoaderFunctionArgs } from "react-router";
import { consumeGoogleOAuthState, getShopDatabase, withShopTransaction } from "../db.server";
import { decryptToken, encryptToken } from "../lib/calendar/secrets.server";
import { exchangeGoogleToken } from "../lib/calendar/client.server";
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const nonce = request.headers.get("Cookie")?.split(";").map(item => item.trim()).find(item => item.startsWith("bn_google_nonce="))?.slice("bn_google_nonce=".length);
  const stateId = z.string().uuid().safeParse(url.searchParams.get("state"));
  if (!nonce || !stateId.success) throw new Response("Calendar connection expired. Start again from BookNest.", { status: 400 });
  const state = await consumeGoogleOAuthState(stateId.data, nonce, DateTime.utc().toJSDate());
  if (!state) throw new Response("Calendar connection expired. Start again from BookNest.", { status: 400 });
  const code = url.searchParams.get("code");
  if (!code || url.searchParams.has("error")) throw new Response("Calendar access was not granted.", { status: 400 });
  const tokens = await exchangeGoogleToken({ grant_type: "authorization_code", code, code_verifier: decryptToken(state.verifier), redirect_uri: process.env.GOOGLE_REDIRECT_URI! });
  if (!tokens.refresh_token) throw new Response("Google did not provide offline access. Reconnect and grant calendar access.", { status: 400 });
  await withShopTransaction(state.shopId, async tx => {
    await tx.staffMember.update({ where: { id: state.staffId }, data: { googleRefreshToken: encryptToken(tokens.refresh_token!), googleCalendarId: "primary", googleSyncError: null } });
    const bookings = await tx.booking.findMany({ where: { staffId: state.staffId, status: "CONFIRMED", startAt: { gt: DateTime.utc().toJSDate() } }, select: { id: true, startAt: true } });
    if (bookings.length) await tx.notificationTask.createMany({ data: bookings.map(booking => ({ shopId: state.shopId, bookingId: booking.id, kind: "CALENDAR_SYNC",
      expectedStartAt: booking.startAt, dedupeKey: "calendar-connect:" + state.id + ":" + booking.id, runAt: DateTime.utc().toJSDate() })), skipDuplicates: true });
  });
  const shop = await getShopDatabase(state.shopId).shop.findUniqueOrThrow({ where: { id: state.shopId }, select: { domain: true } });
  return new Response(null, { status: 303, headers: { Location: "https://" + shop.domain + "/admin/apps/" + process.env.SHOPIFY_API_KEY + "/app/calendar",
    "Set-Cookie": "bn_google_nonce=; HttpOnly; Secure; SameSite=Lax; Path=/auth/google; Max-Age=0", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
