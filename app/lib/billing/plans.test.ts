import { describe, expect, it } from "vitest";
import { subscriptionState, pricingUrl } from "./plans";
const active = (items: unknown[]) => ({ shop: { id: "gid://shopify/Shop/1", myshopifyDomain: "store.myshopify.com" }, items, trialEndsAt: null, currentBillingCycle: { startTime: "2026-10-01T00:00:00Z", endTime: "2026-11-01T00:00:00Z" }, cancelAtEndOfCycle: false });
describe("Shopify App Pricing state", () => {
  it("maps an active subscription item, not the redirect query parameter", () => {
    const value = subscriptionState(active([{ handle: "pro", price: { active: true } }]), "store.myshopify.com", "gid://shopify/Shop/1");
    expect(value).toMatchObject({ plan: "PRO", status: "ACTIVE" });
  });
  it("does not grant a paid plan for a missing, inactive or unknown item", () => {
    expect(subscriptionState(null, "store.myshopify.com", "gid://shopify/Shop/1").status).toBe("INACTIVE");
    expect(subscriptionState(active([{ handle: "pro", price: { active: false } }]), "store.myshopify.com", "gid://shopify/Shop/1").status).toBe("UNRECOGNIZED");
    expect(subscriptionState(active([{ handle: "made-up", price: { active: true } }]), "store.myshopify.com", "gid://shopify/Shop/1").status).toBe("UNRECOGNIZED");
  });
  it("rejects a response belonging to another store", () => {
    expect(() => subscriptionState(active([{ handle: "pro", price: { active: true } }]), "other.myshopify.com", "gid://shopify/Shop/2")).toThrow();
  });
  it("builds only a Shopify-hosted pricing URL", () => {
    expect(pricingUrl("store.myshopify.com", "booknest")).toBe("https://admin.shopify.com/store/store/charges/booknest/pricing_plans");
    expect(() => pricingUrl("other.example", "booknest")).toThrow();
    expect(() => pricingUrl("store.myshopify.com", "../other")).toThrow();
  });
});
