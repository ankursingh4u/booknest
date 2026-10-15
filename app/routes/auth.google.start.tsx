import { createHash, randomBytes } from "node:crypto";
import { DateTime } from "luxon";
import { z } from "zod";
import { data, useLoaderData } from "react-router";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { requireShop } from "../lib/auth/admin.server";
import { encryptToken, nonceHash } from "../lib/calendar/secrets.server";
export const headers: HeadersFunction = ({ loaderHeaders }) => {
  const headers = new Headers(loaderHeaders); headers.set("Cache-Control", "no-store"); headers.set("Referrer-Policy", "no-referrer"); return headers;
};
export async function loader({ request }: LoaderFunctionArgs) {
  const { shop, db } = await requireShop(request);
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_REDIRECT_URI) throw new Response("Google Calendar is not configured.", { status: 503 });
  const staffId = z.string().min(1).max(100).parse(new URL(request.url).searchParams.get("staffId"));
  const staff = await db.staffMember.findUniqueOrThrow({ where: { id: staffId }, select: { firstName: true, lastName: true } });
  const nonce = randomBytes(32).toString("base64url"); const verifier = randomBytes(48).toString("base64url");
  const state = await db.googleOAuthState.create({ data: { shopId: shop.id, staffId, nonceHash: nonceHash(nonce),
    verifier: encryptToken(verifier), expiresAt: DateTime.utc().plus({ minutes: 10 }).toJSDate() } });
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, redirect_uri: process.env.GOOGLE_REDIRECT_URI,
    response_type: "code", scope: "https://www.googleapis.com/auth/calendar.events", access_type: "offline", prompt: "consent",
    state: state.id, code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" }).toString();
  return data({ shop: shop.domain, staff: staff.firstName + " " + staff.lastName, authorizeUrl: url.href }, {
    headers: { "Set-Cookie": "bn_google_nonce=" + nonce + "; HttpOnly; Secure; SameSite=Lax; Path=/auth/google; Max-Age=600" },
  });
}
export default function GoogleConsent() {
  const { shop, staff, authorizeUrl } = useLoaderData<typeof loader>();
  return <main className="bn-login"><section className="bn-login-card bn-form"><h1>Connect Google Calendar</h1>
    <p>Connect your primary calendar to <strong>{staff}</strong> at <strong>{shop}</strong>.</p>
    <p>BookNest will check busy times and add, update, or remove appointments booked through this store.</p>
    <a className="bn-primary-link" href={authorizeUrl} rel="noreferrer">Continue to Google</a>
  </section></main>;
}
