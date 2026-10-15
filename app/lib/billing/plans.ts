import { z } from "zod";
import type { Plan } from "@prisma/client";
export const plans = [{ id: "FREE", title: "Free", monthly: 0 }, { id: "STANDARD", title: "Standard", monthly: 15 }, { id: "PRO", title: "Pro", monthly: 29 }, { id: "PRO_PLUS", title: "Pro Plus", monthly: 39 }] as const;
const subscription = z.object({
  shop: z.object({ id: z.string(), myshopifyDomain: z.string() }),
  items: z.array(z.object({ handle: z.string(), price: z.object({ active: z.boolean() }) })),
  trialEndsAt: z.string().datetime({ offset: true }).nullable(),
  currentBillingCycle: z.object({ startTime: z.string().datetime({ offset: true }), endTime: z.string().datetime({ offset: true }) }).nullable(),
  cancelAtEndOfCycle: z.boolean(),
});
export function subscriptionState(raw: unknown, domain: string, shopGid: string, handles: Record<string, Plan> = { free: "FREE", standard: "STANDARD", pro: "PRO", "pro-plus": "PRO_PLUS" }) {
  if (raw === null) return { plan: "FREE" as Plan, status: "INACTIVE", currentPeriodStart: null, currentPeriodEnd: null, trialEndsAt: null, cancelAtEndOfCycle: false };
  const value = subscription.parse(raw);
  if (value.shop.id !== shopGid || value.shop.myshopifyDomain !== domain) throw new Error("Billing store identity mismatch");
  const matching = value.items.filter(item => item.price.active && Object.hasOwn(handles, item.handle)).map(item => handles[item.handle]!);
  const plan = matching.length === 1 ? matching[0]! : "FREE";
  return { plan, status: matching.length === 1 ? "ACTIVE" : "UNRECOGNIZED", currentPeriodStart: value.currentBillingCycle?.startTime ?? null, currentPeriodEnd: value.currentBillingCycle?.endTime ?? null,
    trialEndsAt: value.trialEndsAt, cancelAtEndOfCycle: value.cancelAtEndOfCycle };
}
export function pricingUrl(domain: string, handle: string) {
  z.string().regex(/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/).parse(domain);
  z.string().regex(/^[a-z0-9][a-z0-9-]*$/).max(100).parse(handle);
  return "https://admin.shopify.com/store/" + domain.replace(".myshopify.com", "") + "/charges/" + handle + "/pricing_plans";
}
