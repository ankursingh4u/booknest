import { redirect } from "react-router";
import { getShopDatabase } from "../../db.server";
import { readTeamToken, teamHeaders } from "./session.server";
import { seatBillingEnabled } from "../billing/seats.server";
export async function requireTeam(request: Request) {
  const token = (request.headers.get("Cookie") ?? "").split(";").map(c => c.trim()).find(c => c.startsWith("__Host-bn-team="))?.slice("__Host-bn-team=".length) ?? "";
  const claims = readTeamToken(token);
  if (!claims) throw redirect("/team/login", { headers: teamHeaders });
  const db = getShopDatabase(claims.shopId);
  const seat = await db.teamSeat.findFirst({ where: { id: claims.seatId, active: true, sessionVersion: claims.version, shop: { uninstalledAt: null } }, select: { id: true, staffId: true, billingConsentAt: true } });
  if (!seat?.staffId) throw redirect("/team/login", { headers: teamHeaders });
  if (seatBillingEnabled()) {
    if (!seat.billingConsentAt) throw new Response("Ask your manager to renew your Team Portal invitation.", { status: 403, headers: teamHeaders });
    const shop = await db.shop.findUniqueOrThrow({ where: { id: claims.shopId }, select: { domain: true } });
    const { unauthenticated } = await import("../../shopify.server");
    const { syncBilling } = await import("../billing/service.server");
    const { admin } = await unauthenticated.admin(shop.domain);
    const billing = await syncBilling(claims.shopId, shop.domain, admin);
    const subscription = await db.subscription.findUnique({ where: { shopId: claims.shopId } });
    if (billing.status !== "ACTIVE" || !subscription?.seatMeterActive) throw new Response("Ask your manager to review the store's Team Portal plan.", { status: 403, headers: teamHeaders });
  }
  const staff = await db.staffMember.findFirst({ where: { id: seat.staffId, active: true }, select: { id: true, firstName: true, lastName: true, timezone: true } });
  if (!staff) throw redirect("/team/login", { headers: teamHeaders });
  return { db, shopId: claims.shopId, seat, staff };
}
