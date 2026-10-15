import type { Prisma } from "@prisma/client";
import { DateTime } from "luxon";
import { z } from "zod";
import { getShopDatabase } from "../../db.server";
export function seatBillingEnabled() { return process.env.TEAM_SEAT_BILLING_ENABLED === "true"; }
export async function queueSeatUsage(db: Prisma.TransactionClient, shopId: string, now: DateTime = DateTime.utc()) {
  if (!seatBillingEnabled()) return;
  const subscription = await db.subscription.findUnique({ where: { shopId } });
  if (!subscription || subscription.status !== "ACTIVE" || !subscription.seatMeterActive || !subscription.shopifyShopGid
    || !subscription.currentPeriodStart || !subscription.currentPeriodEnd
    || subscription.currentPeriodStart > now.toJSDate() || subscription.currentPeriodEnd <= now.toJSDate()) return;
  const seats = await db.teamSeat.findMany({ where: { active: true, billingConsentAt: { not: null } }, select: { id: true } });
  if (!seats.length) return;
  await db.seatUsage.createMany({ skipDuplicates: true, data: seats.map(seat => ({
    shopId, seatId: seat.id, shopifyShopGid: subscription.shopifyShopGid!, periodStart: subscription.currentPeriodStart!,
    periodEnd: subscription.currentPeriodEnd!, occurredAt: now.toJSDate(),
  })) });
}
let cachedToken: { token: string; expires: number } | undefined;
async function appEventToken() {
  if (cachedToken && cachedToken.expires > DateTime.utc().toMillis()) return cachedToken.token;
  if (!process.env.SHOPIFY_API_KEY || !process.env.SHOPIFY_API_SECRET) throw new Error("App Events credentials are missing");
  const response = await fetch("https://api.shopify.com/auth/access_token", { method: "POST", signal: AbortSignal.timeout(8000),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: process.env.SHOPIFY_API_KEY, client_secret: process.env.SHOPIFY_API_SECRET, grant_type: "client_credentials" }) });
  if (!response.ok) throw new Error("App Events authentication failed");
  const token = z.object({ access_token: z.string(), scope: z.string(), expires_in: z.number().positive() }).parse(await response.json());
  if (!token.scope.split(/[ ,]+/).includes("write_global_api_app_events")) throw new Error("App Events access is missing");
  cachedToken = { token: token.access_token, expires: DateTime.utc().plus({ seconds: Math.max(1, token.expires_in - 60) }).toMillis() };
  return cachedToken.token;
}
export async function submitSeatUsage(shopId: string, id: string) {
  if (!seatBillingEnabled()) return;
  const db = getShopDatabase(shopId);
  const usage = await db.seatUsage.findUnique({ where: { id } });
  if (!usage || usage.submittedAt || usage.attempts >= 5) return;
  const handle = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/).parse(process.env.SHOPIFY_TEAM_SEAT_METER_HANDLE);
  const response = await fetch("https://api.shopify.com/app/unstable/events", {
    method: "POST", signal: AbortSignal.timeout(8000),
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + await appEventToken() },
    body: JSON.stringify({ shop_id: usage.shopifyShopGid, event_handle: handle, timestamp: usage.occurredAt.toISOString(),
      idempotency_key: "seat-" + usage.id, attributes: { value: 1 } }),
  });
  if (response.status === 401) cachedToken = undefined;
  if (response.status !== 202) throw new Error("Seat usage could not be submitted");
  // 202 confirms transport only. Shopify's Dev Dashboard confirms billable acceptance.
  await db.seatUsage.update({ where: { id }, data: { submittedAt: DateTime.utc().toJSDate(), lastError: null } });
}
