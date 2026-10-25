import { describe, expect, it } from "vitest";
import { adminSubscriptionState, pricingUrl } from "./plans";
const recurring = (amount: string) => ({ plan: { pricingDetails: { price: { amount, currencyCode: "USD" }, interval: "EVERY_30_DAYS" } } });
const subscription = (overrides: Record<string, unknown> = {}) => ({
  name: "Pro", status: "ACTIVE", test: false, createdAt: "2026-10-01T00:00:00Z",
  trialDays: 0, currentPeriodEnd: "2026-11-01T00:00:00Z", lineItems: [recurring("29.00")], ...overrides,
});
describe("Shopify App Pricing state from the Admin API", () => {
  it("maps an active subscription by plan name", () => {
    expect(adminSubscriptionState([subscription()])).toMatchObject({ plan: "PRO", status: "ACTIVE" });
    expect(adminSubscriptionState([subscription({ name: "Pro Plus", lineItems: [recurring("39.00")] })])).toMatchObject({ plan: "PRO_PLUS", status: "ACTIVE" });
    expect(adminSubscriptionState([subscription({ name: "pro-plus" })])).toMatchObject({ plan: "PRO_PLUS", status: "ACTIVE" });
  });
  it("falls back to the recurring price when the name is custom", () => {
    expect(adminSubscriptionState([subscription({ name: "My Custom Tier", lineItems: [recurring("15.00")] })])).toMatchObject({ plan: "STANDARD", status: "ACTIVE" });
  });
  it("accepts dev-store test subscriptions", () => {
    expect(adminSubscriptionState([subscription({ test: true })])).toMatchObject({ plan: "PRO", status: "ACTIVE" });
  });
  it("reports no subscription as INACTIVE and an unknown plan as UNRECOGNIZED", () => {
    expect(adminSubscriptionState([])).toMatchObject({ plan: "FREE", status: "INACTIVE" });
    expect(adminSubscriptionState([subscription({ name: "Mystery", lineItems: [recurring("99.00")] })]).status).toBe("UNRECOGNIZED");
  });
  it("derives the trial end from creation date and trial days", () => {
    const state = adminSubscriptionState([subscription({ trialDays: 7 })]);
    expect(state.trialEndsAt).toBe("2026-10-08T00:00:00.000Z");
    expect(adminSubscriptionState([subscription()]).trialEndsAt).toBeNull();
  });
  it("builds only a Shopify-hosted pricing URL", () => {
    expect(pricingUrl("store.myshopify.com", "booknest")).toBe("https://admin.shopify.com/store/store/charges/booknest/pricing_plans");
    expect(() => pricingUrl("other.example", "booknest")).toThrow();
    expect(() => pricingUrl("store.myshopify.com", "../other")).toThrow();
  });
});
