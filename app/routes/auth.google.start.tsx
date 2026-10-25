import { createHash, randomBytes } from "node:crypto";
import { DateTime } from "luxon";
import { data, useLoaderData } from "react-router";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { findShopIdentity, getShopDatabase } from "../db.server";
import { shopFromSessionToken } from "../lib/auth/session-token.server";
import { encryptToken, nonceHash } from "../lib/calendar/secrets.server";
export const headers: HeadersFunction = ({ loaderHeaders }) => {
  const headers = new Headers(loaderHeaders); headers.set("Cache-Control", "no-store"); headers.set("Referrer-Policy", "no-referrer"); return headers;
};
export async function loader({ request }: LoaderFunctionArgs) {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_REDIRECT_URI) throw new Response("Google Calendar is not configured.", { status: 503 });
  // This runs in a top-level window (Google's OAuth page can't load inside the Shopify iframe), so
  // we authenticate from the App Bridge session token directly rather than the embedded flow, which
  // would need a host param the window.open("_top") navigation can't carry.
  const url = new URL(request.url);
  let shopDomain: string;
  try { shopDomain = shopFromSessionToken(url.searchParams.get("id_token") || ""); }
  catch { throw new Response("Your BookNest session expired. Reopen BookNest and click Connect calendar again.", { status: 401 }); }
  const shop = await findShopIdentity(shopDomain);
  if (!shop) throw new Response("This store is not connected to BookNest.", { status: 404 });
  const db = getShopDatabase(shop.id);
  const nonce = randomBytes(32).toString("base64url"); const verifier = randomBytes(48).toString("base64url");
  const state = await db.googleOAuthState.create({ data: { shopId: shop.id, nonceHash: nonceHash(nonce),
    verifier: encryptToken(verifier), expiresAt: DateTime.utc().plus({ minutes: 10 }).toJSDate() } });
  const authorize = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorize.search = new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, redirect_uri: process.env.GOOGLE_REDIRECT_URI,
    response_type: "code", scope: "https://www.googleapis.com/auth/calendar.events", access_type: "offline", prompt: "consent",
    state: state.id, code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" }).toString();
  return data({ shop: shop.domain, authorizeUrl: authorize.href }, {
    headers: { "Set-Cookie": "bn_google_nonce=" + nonce + "; HttpOnly; Secure; SameSite=Lax; Path=/auth/google; Max-Age=600" },
  });
}
export default function GoogleConsent() {
  const { shop, authorizeUrl } = useLoaderData<typeof loader>();
  return <main className="bn-login"><section className="bn-login-card bn-form"><h1>Connect Google Calendar</h1>
    <p>Connect one Google Calendar for <strong>{shop}</strong>. Every booking in this store will sync to it.</p>
    <p>BookNest will check busy times and add, update, or remove appointments booked through this store.</p>
    <a className="bn-primary-link" href={authorizeUrl} rel="noreferrer">Continue to Google</a>
  </section></main>;
}
