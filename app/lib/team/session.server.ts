import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
const claims = z.object({ shopId: z.string().min(1).max(100), seatId: z.string().min(1).max(100), version: z.number().int().nonnegative(), exp: z.number().int() });
function signature(value: string) {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("A session secret of at least 32 characters is required");
  return createHmac("sha256", secret).update("booknest-team:" + value).digest("base64url");
}
export function createTeamToken(value: Omit<z.infer<typeof claims>, "exp">, now = Math.floor(Date.now() / 1000)) {
  const body = Buffer.from(JSON.stringify(claims.parse({ ...value, exp: now + 12 * 60 * 60 }))).toString("base64url");
  return body + "." + signature(body);
}
export function readTeamToken(token: string, now = Math.floor(Date.now() / 1000)) {
  if (token.length > 2000) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, supplied] = parts as [string, string];
  const expected = signature(body);
  if (!/^[a-zA-Z0-9_-]+$/.test(supplied) || supplied.length !== expected.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) return null;
  try {
    const value = claims.parse(JSON.parse(Buffer.from(body, "base64url").toString()));
    return value.exp > now ? value : null;
  } catch { return null; }
}
export function requireSameOrigin(request: Request) {
  const expected = new URL(process.env.SHOPIFY_APP_URL || request.url).origin;
  if (request.headers.get("Origin") !== expected) throw new Response("Please submit this form from BookNest.", { status: 403 });
}
export const teamHeaders = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" };
export function teamCookie(token: string, clear = false) {
  return "__Host-bn-team=" + token + "; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=" + (clear ? 0 : 43200);
}
