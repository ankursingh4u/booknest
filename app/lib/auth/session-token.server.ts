import { createHmac, timingSafeEqual } from "node:crypto";
import { readShopifyConfig } from "../shopify/config.server";

// Verifies a Shopify App Bridge session token (id_token) and returns the shop's myshopify domain.
// Used by top-level flows such as the Google OAuth start, where the embedded `authenticate.admin`
// helper can't run (there is no `host` param on a window.open("_top") navigation). Throws if the
// token is malformed, tampered with, expired, or not issued for this app.
export function shopFromSessionToken(token: string, now = Date.now()): string {
  const { apiKey, apiSecretKey } = readShopifyConfig();
  const [header, payload, signature] = token.split(".");
  if (!header || !payload || !signature) throw new Error("Malformed session token");
  const expected = createHmac("sha256", apiSecretKey).update(header + "." + payload).digest("base64url");
  const given = Buffer.from(signature), want = Buffer.from(expected);
  if (given.length !== want.length || !timingSafeEqual(given, want)) throw new Error("Bad session token signature");
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { aud?: string; exp?: number; nbf?: number; dest?: string };
  const seconds = Math.floor(now / 1000);
  if (claims.aud !== apiKey) throw new Error("Session token audience mismatch");
  if (typeof claims.exp !== "number" || claims.exp < seconds) throw new Error("Session token expired");
  if (typeof claims.nbf === "number" && claims.nbf > seconds + 5) throw new Error("Session token not yet valid");
  if (!claims.dest) throw new Error("Session token missing destination");
  const host = new URL(claims.dest).hostname;
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(host)) throw new Error("Invalid shop in session token");
  return host;
}
