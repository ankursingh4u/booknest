import { DateTime } from "luxon";
import { z } from "zod";
import { getShopDatabase, withShopTransaction } from "../../db.server";
import { BookingError } from "../bookings/validation";
import type { AdminGraphql } from "../shopify/variant.server";
import { pricingUrl, subscriptionState } from "./plans";
import { queueSeatUsage } from "./seats.server";
export function billingConfigured() {
  return Boolean(process.env.SHOPIFY_PARTNER_ORG_ID && process.env.SHOPIFY_PARTNER_API_TOKEN);
}
const identitySchema = z.object({ data: z.object({
  shop: z.object({ id: z.string().regex(/^gid:\/\/shopify\/Shop\/\d+$/), myshopifyDomain: z.string() }),
  currentAppInstallation: z.object({ app: z.object({ id: z.string().regex(/^gid:\/\/shopify\/App\/\d+$/), handle: z.string().nullable() }) }),
}) });
const inFlight = new Map<string, Promise<{ status: string; plan: string; pricingUrl: string | null; cancelAtEndOfCycle?: boolean }>>();
export async function syncBilling(shopId: string, domain: string, admin: AdminGraphql, force = false) {
  if (!billingConfigured()) return { status: "NOT_CONFIGURED", plan: "FREE", pricingUrl: null };
  const db = getShopDatabase(shopId);
  if (!force) {
    const cached = await db.subscription.findUnique({ where: { shopId } });
    if (cached && (!cached.currentPeriodEnd || cached.currentPeriodEnd > DateTime.utc().toJSDate()) && DateTime.fromJSDate(cached.updatedAt) > DateTime.utc().minus({ minutes: 5 })) return { status: cached.status, plan: cached.plan, pricingUrl: null };
  }
  if (inFlight.has(shopId)) return inFlight.get(shopId)!;
  const work = (async () => {
    const response = await admin.graphql("query BookNestBillingIdentity { shop { id myshopifyDomain } currentAppInstallation { app { id handle } } }");
    const identity = identitySchema.parse(await response.json()).data;
    if (identity.shop.myshopifyDomain !== domain) throw new Error("Billing store identity mismatch");
    const org = z.string().regex(/^\d+$/).parse(process.env.SHOPIFY_PARTNER_ORG_ID);
    const result = await fetch("https://partners.shopify.com/" + org + "/api/2026-07/graphql.json", {
      method: "POST", signal: AbortSignal.timeout(8000),
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": process.env.SHOPIFY_PARTNER_API_TOKEN! },
      body: JSON.stringify({ query: "query BookNestSubscription($appId: ID!, $shopId: ID!) { activeSubscription(appId: $appId, shopId: $shopId) { shop { id myshopifyDomain } items { handle price { active } } trialEndsAt currentBillingCycle { startTime endTime } cancelAtEndOfCycle } }",
        variables: { appId: identity.currentAppInstallation.app.id, shopId: identity.shop.id } }),
    });
    const payload = z.object({ data: z.object({ activeSubscription: z.unknown() }), errors: z.array(z.unknown()).optional() }).safeParse(await result.json());
    if (!result.ok || !payload.success || payload.data.errors?.length || payload.data.data.activeSubscription === undefined) throw new BookingError("Plan verification is temporarily unavailable. Please try again.", 503);
    const handles = {
      [process.env.SHOPIFY_PLAN_FREE_HANDLE || "free"]: "FREE" as const,
      [process.env.SHOPIFY_PLAN_STANDARD_HANDLE || "standard"]: "STANDARD" as const,
      [process.env.SHOPIFY_PLAN_PRO_HANDLE || "pro"]: "PRO" as const,
      [process.env.SHOPIFY_PLAN_PRO_PLUS_HANDLE || "pro-plus"]: "PRO_PLUS" as const,
    };
    const state = subscriptionState(payload.data.data.activeSubscription, domain, identity.shop.id, handles);
    await withShopTransaction(shopId, async tx => {
      const items = z.object({ items: z.array(z.object({ handle: z.string(), price: z.object({ active: z.boolean() }) })) }).nullable().parse(payload.data.data.activeSubscription);
      const value = { plan: state.plan, status: state.status, shopifyShopGid: identity.shop.id,
        seatMeterActive: Boolean(process.env.SHOPIFY_TEAM_SEAT_METER_HANDLE && items?.items.some(item => item.price.active && item.handle === process.env.SHOPIFY_TEAM_SEAT_METER_HANDLE)),
        currentPeriodStart: state.currentPeriodStart ? DateTime.fromISO(state.currentPeriodStart).toJSDate() : null, currentPeriodEnd: state.currentPeriodEnd ? DateTime.fromISO(state.currentPeriodEnd).toJSDate() : null };
      await tx.subscription.upsert({ where: { shopId }, create: { shopId, ...value }, update: value });
      await queueSeatUsage(tx, shopId);
      await tx.shop.update({ where: { id: shopId }, data: { plan: state.plan, trialEndsAt: state.trialEndsAt ? DateTime.fromISO(state.trialEndsAt).toJSDate() : null } });
    });
    const handle = process.env.SHOPIFY_APP_HANDLE || identity.currentAppInstallation.app.handle;
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
