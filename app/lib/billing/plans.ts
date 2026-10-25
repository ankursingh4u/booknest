import { DateTime } from "luxon";
import { z } from "zod";
import type { Plan } from "@prisma/client";
export const plans = [{ id: "FREE", title: "Free", monthly: 0 }, { id: "STANDARD", title: "Standard", monthly: 15 }, { id: "PRO", title: "Pro", monthly: 29 }, { id: "PRO_PLUS", title: "Pro Plus", monthly: 39 }] as const;
const subscription = z.object({
  name: z.string(),
  status: z.string(),
  test: z.boolean(),
  createdAt: z.string(),
  trialDays: z.number().int().min(0),
  currentPeriodEnd: z.string().nullable(),
  lineItems: z.array(z.object({ plan: z.object({ pricingDetails: z.object({
    price: z.object({ amount: z.string(), currencyCode: z.string() }).optional(),
    interval: z.string().optional(),
  }).passthrough() }) })),
});
const names: Record<string, Plan> = { free: "FREE", standard: "STANDARD", pro: "PRO", "pro plus": "PRO_PLUS" };
function matchPlan(value: z.infer<typeof subscription>): Plan | null {
  const name = value.name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (Object.hasOwn(names, name)) return names[name]!;
  const amounts = value.lineItems.map(item => item.plan.pricingDetails.price?.amount).filter((amount): amount is string => Boolean(amount));
  if (amounts.length !== 1) return null;
  return plans.find(plan => plan.monthly === Number(amounts[0]))?.id ?? null;
}
// The Admin API reports the app's own subscription for the current store, so no identity
// cross-check is needed the way the Partner API required; the session token scopes the store.
export function adminSubscriptionState(raw: unknown) {
  const values = z.array(subscription).parse(raw).filter(item => item.status === "ACTIVE");
  if (values.length === 0) return { plan: "FREE" as Plan, status: "INACTIVE", currentPeriodStart: null, currentPeriodEnd: null, trialEndsAt: null, cancelAtEndOfCycle: false, usagePricing: false };
  const value = values.length === 1 ? values[0]! : null;
  const plan = value ? matchPlan(value) : null;
  if (!value || !plan) return { plan: "FREE" as Plan, status: "UNRECOGNIZED", currentPeriodStart: null, currentPeriodEnd: null, trialEndsAt: null, cancelAtEndOfCycle: false, usagePricing: false };
  const created = DateTime.fromISO(value.createdAt, { zone: "utc" });
  return {
    plan, status: "ACTIVE",
    currentPeriodStart: null,
    currentPeriodEnd: value.currentPeriodEnd,
    trialEndsAt: value.trialDays > 0 && created.isValid ? created.plus({ days: value.trialDays }).toISO() : null,
    cancelAtEndOfCycle: false,
    usagePricing: value.lineItems.some(item => !item.plan.pricingDetails.price),
  };
}
export function pricingUrl(domain: string, handle: string) {
  z.string().regex(/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/).parse(domain);
  z.string().regex(/^[a-z0-9][a-z0-9-]*$/).max(100).parse(handle);
  return "https://admin.shopify.com/store/" + domain.replace(".myshopify.com", "") + "/charges/" + handle + "/pricing_plans";
}
