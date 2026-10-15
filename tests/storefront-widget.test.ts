import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

function core(extra: Record<string, unknown> = {}) {
  const module = { exports: {} as Record<string, any> };
  try { runInNewContext(readFileSync("extensions/booknest-widget/assets/booknest.js", "utf8"), { module, URL, Map, Set, AbortController, setTimeout, clearTimeout, ...extra }); } catch {}
  return module.exports;
}
describe("storefront booking safeguards", () => {
  it("takes the product form's current variant before an outdated URL or Liquid default", () => {
    expect(core().activeVariant({ formVariant: "22", urlVariant: "11", fallback: "11", productVariants: ["11", "22"] })).toBe("22");
  });
  it("does not intercept another product's cart form", () => {
    expect(core().variantGate("99", ["11", "22"], new Map([["11", true]]))).toBe("pass");
  });
  it("gates linked variants and permits verified ordinary variants", () => {
    const status = new Map([["11", true], ["22", false]]);
    expect(core().variantGate("11", ["11", "22"], status)).toBe("book");
    expect(core().variantGate("22", ["11", "22"], status)).toBe("pass");
    expect(core().variantGate("33", ["11", "22", "33"], status)).toBe("resolve");
  });
  it("deduplicates current variant lookup but lets failed catalog loads retry", async () => {
    const loader = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ services: [{ id: "service" }] });
    const resolver = core().variantResolver(loader);
    await expect(resolver.load("11")).rejects.toThrow("offline");
    expect(resolver.status.has("11")).toBe(false);
    const [first, second] = await Promise.all([resolver.load("11"), resolver.load("11")]);
    expect(first).toBe(second);
    expect(loader).toHaveBeenCalledTimes(2);
    expect(resolver.status.get("11")).toBe(true);
  });
  it("hides accelerated checkout using inline priority and restores the merchant style", () => {
    const properties = new Map<string, [string, string]>([["display", ["inline-flex", ""]]]);
    const button = { hidden: false, style: { getPropertyValue: (key: string) => properties.get(key)?.[0] || "", getPropertyPriority: (key: string) => properties.get(key)?.[1] || "", setProperty: (key: string, value: string, priority = "") => properties.set(key, [value, priority]), removeProperty: (key: string) => properties.delete(key) } };
    const history = new Map();
    const helpers = core();
    helpers.setNativeVisibility(button, true, history);
    expect(button.hidden).toBe(true); expect(properties.get("display")).toEqual(["none", "important"]);
    helpers.setNativeVisibility(button, false, history);
    expect(button.hidden).toBe(false); expect(properties.get("display")).toEqual(["inline-flex", ""]);
  });
  it("lets a failed slot request be retried with a fresh request", async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ ok: true, json: async () => ({ slots: [{ startAt: "2026-11-01T10:00:00Z" }] }) });
    const helpers = core({ fetch });
    await expect(helpers.request("/slots?date=2026-11-01")).rejects.toThrow("offline");
    expect((await helpers.request("/slots?date=2026-11-01")).slots).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("rejects a catalog service linked to a different Shopify variant", async () => {
    const resolver = core().variantResolver(async () => ({ services: [{ id: "wrong", variantId: "gid://shopify/ProductVariant/22" }, { id: "matching", variantId: "gid://shopify/ProductVariant/11" }] }));
    expect((await resolver.load("11")).services.map((service: { id: string }) => service.id)).toEqual(["matching"]);
    expect(resolver.status.get("11")).toBe(true);
  });
  it("calculates keyboard calendar navigation without timezone arithmetic", () => {
    const helpers = core();
    expect(helpers.calendarKeyDate("2028-03-31", "PageUp")).toBe("2028-02-29");
    expect(helpers.calendarKeyDate("2026-11-01", "ArrowLeft")).toBe("2026-10-31");
    expect(helpers.calendarKeyDate("2026-11-04", "Home")).toBe("2026-11-01");
    expect(helpers.calendarKeyDate("2026-11-04", "End")).toBe("2026-11-07");
    expect(helpers.calendarKeyDate("2026-11-01", "ArrowDown")).toBe("2026-11-08");
    expect(helpers.calendarKeyDate("2026-11-01", "Enter")).toBe(null);
  });
  it("gives one widget ownership of a native form and releases a removed section before transfer", () => {
    const owners = new Map(), form = {}, firstRoot = { isConnected: true }, secondRoot = { isConnected: true }, release = vi.fn();
    const helpers = core();
    expect(helpers.claimNativeForm(form, firstRoot, owners, release)).toBe(true);
    expect(helpers.claimNativeForm(form, secondRoot, owners, vi.fn())).toBe(false);
    firstRoot.isConnected = false;
    expect(helpers.claimNativeForm(form, secondRoot, owners, vi.fn())).toBe(true);
    expect(release).toHaveBeenCalledWith(form);
  });
  it("keeps checkout locked until the exact server hold expiry", () => {
    const helpers = core();
    const hold = { expiresAt: "2026-11-01T10:15:00Z" };
    expect(helpers.isHoldActive(hold, Date.parse("2026-11-01T10:14:59Z"))).toBe(true);
    expect(helpers.isHoldActive(hold, Date.parse("2026-11-01T10:15:00Z"))).toBe(false);
    expect(helpers.isHoldActive(null, Date.now())).toBe(false);
    expect(helpers.isHoldActive({ expiresAt: "invalid" }, Date.now())).toBe(false);
  });
  it("keeps custom accent buttons and focus indicators visible on light and dark themes", () => {
    const helpers = core();
    expect(helpers.accentPresentation("#ffffff")).toEqual({ foreground: "#000000", focus: "#202223" });
    expect(helpers.accentPresentation("#000000")).toEqual({ foreground: "#ffffff", focus: "#000000" });
    expect(helpers.accentPresentation("#000000", true)).toEqual({ foreground: "#ffffff", focus: "#ffffff" });
  });
  it("uses a civil calendar across leap years and month boundaries", () => {
    const helpers = core();
    expect(helpers.monthDates("2028-02")).toHaveLength(29);
    expect(helpers.monthDates("2027-02")).toHaveLength(28);
    expect(helpers.shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(helpers.shiftDay("2026-11-01", -1)).toBe("2026-10-31");
    expect(helpers.weekday("2026-11-01")).toBe(0);
  });
});
