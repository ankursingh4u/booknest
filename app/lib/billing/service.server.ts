import { DateTime } from "luxon";
import { z } from "zod";
import { getShopDatabase, withShopTransaction } from "../../db.server";
import { BookingError } from "../bookings/validation";
import type { AdminGraphql } from "../shopify/variant.server";
import { adminSubscriptionState, pricingUrl } from "./plans";
import { queueSeatUsage } from "./seats.server";
// Plan state comes from the Admin API's own installation record, so billing needs no
// extra credentials beyond the store access token the app already holds.
export function billingConfigured() {
  return true;
}
const billingQuery = `query BookNestBilling { shop { id myshopifyDomain } currentAppInstallation { app { handle }
  activeSubscriptions { name status test createdAt trialDays currentPeriodEnd
    lineItems { plan { pricingDetails { ... on AppRecurringPricing { price { amount currencyCode } interval } ... on AppUsagePricing { terms } } } } } } }`;
const billingSchema = z.object({ data: z.object({
  shop: z.object({ id: z.string().regex(/^gid:\/\/shopify\/Shop\/\d+$/), myshopifyDomain: z.string() }),
  currentAppInstallation: z.object({ app: z.object({ handle: z.string().nullable() }), activeSubscriptions: z.array(z.unknown()) }),
}) });
const inFlight = new Map<string, Promise<{ status: string; plan: string; pricingUrl: string | null; cancelAtEndOfCycle?: boolean }>>();
export async function syncBilling(shopId: string, domain: string, admin: AdminGraphql, force = false) {
  const db = getShopDatabase(shopId);
  if (!force) {
    const cached = await db.subscription.findUnique({ where: { shopId } });
    if (cached && (!cached.currentPeriodEnd || cached.currentPeriodEnd > DateTime.utc().toJSDate()) && DateTime.fromJSDate(cached.updatedAt) > DateTime.utc().minus({ minutes: 5 })) return { status: cached.status, plan: cached.plan, pricingUrl: null };
  }
  if (inFlight.has(shopId)) return inFlight.get(shopId)!;
  const work = (async () => {
    const response = await admin.graphql(billingQuery);
    const payload = billingSchema.safeParse(await response.json());
    if (!payload.success) throw new BookingError("Plan verification is temporarily unavailable. Please try again.", 503);
    if (payload.data.data.shop.myshopifyDomain !== domain) throw new Error("Billing store identity mismatch");
    const state = adminSubscriptionState(payload.data.data.currentAppInstallation.activeSubscriptions);
    await withShopTransaction(shopId, async tx => {
      const value = { plan: state.plan, status: state.status, shopifyShopGid: payload.data.data.shop.id,
        seatMeterActive: Boolean(process.env.SHOPIFY_TEAM_SEAT_METER_HANDLE) && state.usagePricing,
        currentPeriodStart: null, currentPeriodEnd: state.currentPeriodEnd ? DateTime.fromISO(state.currentPeriodEnd).toJSDate() : null };
      await tx.subscription.upsert({ where: { shopId }, create: { shopId, ...value }, update: value });
      await queueSeatUsage(tx, shopId);
      await tx.shop.update({ where: { id: shopId }, data: { plan: state.plan, trialEndsAt: state.trialEndsAt ? DateTime.fromISO(state.trialEndsAt).toJSDate() : null } });
    });
    const handle = process.env.SHOPIFY_APP_HANDLE || payload.data.data.currentAppInstallation.app.handle;
    return { ...state, pricingUrl: handle ? pricingUrl(domain, handle) : null };
  })();
  inFlight.set(shopId, work);
  try { return await work; } finally { inFlight.delete(shopId); }
}
export async function requireActivePlan(shopId: string, domain: string, admin: AdminGraphql) {
  if (process.env.BILLING_ENFORCEMENT !== "true") return;
  const state = await syncBilling(shopId, domain, admin);
  if (state.status !== "ACTIVE") throw new BookingError("The store's booking plan needs attention. Please contact the store.", 503);
}
