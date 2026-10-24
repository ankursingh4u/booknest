import { createHmac } from "node:crypto";
import { describe, it, expect, vi } from "vitest";
vi.mock("../shopify/config.server", () => ({ readShopifyConfig: () => ({ apiKey: "KEY", apiSecretKey: "SECRET" }) }));
import { shopFromSessionToken } from "./session-token.server";

const now = Date.parse("2026-11-01T10:00:00Z");
const secs = Math.floor(now / 1000);
const base = { aud: "KEY", exp: secs + 60, nbf: secs - 10, dest: "https://test1booknest.myshopify.com" };
function token(claims: Record<string, unknown>, secret = "SECRET") {
  const b = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const h = b({ alg: "HS256", typ: "JWT" }), p = b(claims);
  return h + "." + p + "." + createHmac("sha256", secret).update(h + "." + p).digest("base64url");
}

describe("shopFromSessionToken", () => {
  it("returns the shop domain for a valid, in-date, correctly-signed token", () => {
    expect(shopFromSessionToken(token(base), now)).toBe("test1booknest.myshopify.com");
  });
  it("rejects a tampered signature", () => {
    expect(() => shopFromSessionToken(token(base, "WRONG-SECRET"), now)).toThrow(/signature/);
  });
  it("rejects an expired token", () => {
    expect(() => shopFromSessionToken(token({ ...base, exp: secs - 1 }), now)).toThrow(/expired/);
  });
  it("rejects a token minted for a different app", () => {
    expect(() => shopFromSessionToken(token({ ...base, aud: "OTHER" }), now)).toThrow(/audience/);
  });
  it("rejects a non-myshopify destination", () => {
    expect(() => shopFromSessionToken(token({ ...base, dest: "https://evil.example.com" }), now)).toThrow(/Invalid shop/);
  });
  it("rejects a malformed token", () => {
    expect(() => shopFromSessionToken("not-a-jwt", now)).toThrow(/Malformed/);
  });
});
