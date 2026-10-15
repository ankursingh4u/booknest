import { createHash, randomBytes } from "node:crypto";
import { DateTime } from "luxon";
import { z } from "zod";
import { Form, useActionData, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Page, Card, BlockStack, Banner } from "@shopify/polaris";
import { requireShop } from "../lib/auth/admin.server";
import { formError } from "../lib/admin/errors.server";
import { Field, SelectField, SaveButton, RecordAction } from "../components/Fields";
import { CatalogError } from "../lib/admin/catalog.server";
import { withShopTransaction } from "../db.server";
import { syncBilling } from "../lib/billing/service.server";
import { queueSeatUsage, seatBillingEnabled } from "../lib/billing/seats.server";
export async function loader({ request }: LoaderFunctionArgs) {
  const { db } = await requireShop(request);
  const [seats, staff] = await Promise.all([
    db.teamSeat.findMany({ select: { id: true, email: true, staffId: true, active: true }, orderBy: { email: "asc" }, take: 500 }),
    db.staffMember.findMany({ where: { active: true }, select: { id: true, firstName: true, lastName: true }, orderBy: { firstName: "asc" }, take: 500 }),
  ]);
  return { seats, staff, billed: seatBillingEnabled() };
}
export async function action({ request }: ActionFunctionArgs) {
  const { db, shop, admin } = await requireShop(request);
  const form = await request.formData();
  try {
    const intent = z.enum(["invite", "revoke"]).parse(form.get("intent"));
    if (intent === "revoke") {
      const id = z.string().min(1).max(100).parse(form.get("id"));
      await db.teamSeat.update({ where: { id }, data: { active: false, inviteTokenHash: null, inviteExpiresAt: null, sessionVersion: { increment: 1 } } });
      return { error: null, invitation: null, revoked: true };
    }
    const email = z.string().trim().email().max(254).transform(s => s.toLowerCase()).parse(form.get("email"));
    const staffId = z.string().min(1).max(100).parse(form.get("staffId"));
    if (!await db.staffMember.findFirst({ where: { id: staffId, active: true }, select: { id: true } })) throw new CatalogError("Choose an active Availability.");
    if (seatBillingEnabled()) {
      if (form.get("billingConsent") !== "yes") throw new CatalogError("Confirm the monthly seat charge before inviting a team member.");
      const billing = await syncBilling(shop.id, shop.domain, admin, true);
      const subscription = await db.subscription.findUnique({ where: { shopId: shop.id } });
      if (billing.status !== "ACTIVE" || !subscription?.seatMeterActive) throw new CatalogError("Choose a Shopify plan with Team Portal seats before inviting a team member.");
    }
    const token = randomBytes(32).toString("base64url");
    const invite = { staffId, active: true, inviteTokenHash: createHash("sha256").update(token).digest("hex"), inviteExpiresAt: DateTime.utc().plus({ hours: 24 }).toJSDate() };
    await withShopTransaction(shop.id, async tx => {
    await tx.teamSeat.upsert({ where: { shopId_email: { shopId: shop.id, email } }, create: { ...invite, shopId: shop.id, email, billingConsentAt: seatBillingEnabled() ? DateTime.utc().toJSDate() : null },
      update: { ...invite, ...(seatBillingEnabled() ? { billingConsentAt: DateTime.utc().toJSDate() } : {}), sessionVersion: { increment: 1 } } });
    await queueSeatUsage(tx, shop.id);
    });
    return { error: null, revoked: false, invitation: new URL("/team/invite/" + token, process.env.SHOPIFY_APP_URL!).href };
  } catch (error) { return formError(error); }
}
export default function Team() {
  const { seats, staff, billed } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  return <Page title="Team Portal"><BlockStack gap="400">
    {result?.error && <Banner tone="critical">{result.error}</Banner>}
    {result && "invitation" in result && result.invitation && <Banner tone="success"><p>Share this private invitation with the team member. It expires in 24 hours and works once.</p><label className="bn-field">Invitation link<input readOnly value={result.invitation} onFocus={event => event.target.select()} /></label></Banner>}
    {result && "revoked" in result && result.revoked && <Banner tone="success">Access revoked. Existing sessions no longer work.</Banner>}
    <Card><Form method="post" className="bn-form"><h2>Invite a team member</h2><p>Team members see bookings for their assigned Availability and can check customers in or request time off.</p>
      <input type="hidden" name="intent" value="invite" /><Field name="email" label="Team member email" type="email" required />
      <SelectField name="staffId" label="Assigned Availability" required options={staff.map(s => ({ value: s.id, label: s.firstName + " " + s.lastName }))} />
      {billed ? <label><input name="billingConsent" type="checkbox" value="yes" required /> I agree to $8 USD per active seat per billing cycle. Removing access stops future-cycle charges; the current cycle is not prorated.</label> : <p>Team Portal is in testing. No seat charges are submitted.</p>}
      <p>Creating another invitation for the same email signs out its existing sessions.</p><SaveButton>Create invitation</SaveButton>
    </Form></Card>
    <Card><BlockStack gap="400"><h2>Team access</h2>{!seats.length && <p>No team members yet.</p>}{seats.map(seat => <article key={seat.id} className="bn-record"><div><strong>{seat.email}</strong><p>{staff.find(s => s.id === seat.staffId)?.firstName ?? "Archived Availability"} · {seat.active ? "Active" : "Revoked"}</p></div>{seat.active && <RecordAction id={seat.id} intent="revoke">Revoke access</RecordAction>}</article>)}</BlockStack></Card>
  </BlockStack></Page>;
}
