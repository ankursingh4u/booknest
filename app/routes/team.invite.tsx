import { createHash } from "node:crypto";
import { DateTime } from "luxon";
import { Form, redirect, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { resolveTeamInvitation } from "../db.server";
import { createTeamToken, requireSameOrigin, teamCookie, teamHeaders } from "../lib/team/session.server";
export const headers = () => teamHeaders;
function hash(token: string | undefined) {
  if (!token || !/^[a-zA-Z0-9_-]{43}$/.test(token)) throw new Response("This invitation is invalid or expired.", { status: 410, headers: teamHeaders });
  return createHash("sha256").update(token).digest("hex");
}
export async function loader({ params }: LoaderFunctionArgs) {
  const seat = await resolveTeamInvitation(hash(params.token), DateTime.utc().toJSDate());
  if (!seat) throw new Response("This invitation is invalid or expired. Ask your store manager for a new one.", { status: 410, headers: teamHeaders });
  return { name: seat.staff.firstName + " " + seat.staff.lastName, domain: seat.shop.domain };
}
export async function action({ request, params }: ActionFunctionArgs) {
  requireSameOrigin(request);
  const seat = await resolveTeamInvitation(hash(params.token), DateTime.utc().toJSDate(), true);
  if (!seat) throw new Response("This invitation was already used or has expired.", { status: 410, headers: teamHeaders });
  const token = createTeamToken({ shopId: seat.shopId, seatId: seat.id, version: seat.sessionVersion });
  return redirect("/team", { headers: { ...teamHeaders, "Set-Cookie": teamCookie(token) } });
}
export default function TeamInvite() {
  const { name, domain } = useLoaderData<typeof loader>();
  return <main className="bn-login"><section className="bn-login-card"><h1>Join the Team Portal</h1><p>Sign in as {name} for {domain}. Your session lasts 12 hours.</p><Form method="post"><button type="submit">Accept invitation and sign in</button></Form></section></main>;
}
