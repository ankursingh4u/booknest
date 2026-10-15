import { describe, expect, it } from "vitest";
import { readShopifyConfig } from "./config.server";

const valid = {
  SHOPIFY_API_KEY: "test-client-id",
  SHOPIFY_API_SECRET: "test-client-secret",
  SHOPIFY_APP_URL: "https://booknestapp.site",
  SCOPES: "read_products, write_products",
};
describe("Shopify startup configuration", () => {
  it("pins the app API version and normalizes scopes", () => {
    expect(readShopifyConfig(valid)).toEqual({
      apiKey: "test-client-id", apiSecretKey: "test-client-secret",
      appUrl: "https://booknestapp.site", scopes: ["read_products", "write_products"],
      apiVersion: "2026-07",
    });
  });
  it.each(["SHOPIFY_API_KEY", "SHOPIFY_API_SECRET", "SHOPIFY_APP_URL", "SCOPES"])("fails early for missing %s", (key) => {
    expect(() => readShopifyConfig({ ...valid, [key]: "" })).toThrow(/configuration/i);
  });
  it("rejects insecure production origins and URL credentials", () => {
    expect(() => readShopifyConfig({ ...valid, SHOPIFY_APP_URL: "http://booknestapp.site" })).toThrow(/configuration/i);
    expect(() => readShopifyConfig({ ...valid, SHOPIFY_APP_URL: "https://user:pass@booknestapp.site" })).toThrow(/configuration/i);
    expect(() => readShopifyConfig({ ...valid, SHOPIFY_APP_URL: "https://booknestapp.site/path" })).toThrow(/configuration/i);
  });
  it("permits a localhost HTTP development origin", () => {
    expect(readShopifyConfig({ ...valid, SHOPIFY_APP_URL: "http://localhost:3000" }).appUrl).toBe("http://localhost:3000");
  });
  it("reports variable names without exposing values", () => {
    try { readShopifyConfig({ ...valid, SHOPIFY_APP_URL: "https://user:private-value@booknestapp.site" }); }
    catch (error) { expect(String(error)).not.toContain("private-value"); }
  });
});
