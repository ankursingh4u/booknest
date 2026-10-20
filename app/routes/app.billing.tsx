import { Form, useLoaderData, useNavigation } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { Page, Card, BlockStack, Banner, Button } from "@shopify/polaris";
import { requireShop } from "../lib/auth/admin.server";
import { billingConfigured, syncBilling } from "../lib/billing/service.server";
import { seatBillingEnabled } from "../lib/billing/seats.server";
import { plans } from "../lib/billing/plans";
export async function loader({ request }: LoaderFunctionArgs) {
  const { shop, db, admin } = await requireShop(request);
  const seats = await db.teamSeat.count({ where: { active: true } });
  try { return { ...await syncBilling(shop.id, shop.domain, admin, true), seats, seatBilling: seatBillingEnabled(), configured: billingConfigured(), error: null }; }
  catch { return { status: "UNAVAILABLE", plan: null, pricingUrl: null, seats, seatBilling: seatBillingEnabled(), configured: billingConfigured(), error: "We could not verify your plan. Refresh to try again." }; }
}
export default function Billing() {
  const data = useLoaderData<typeof loader>(), navigation = useNavigation();
  return <Page title="Account and plan" subtitle="Your BookNest subscription and Team Portal seat billing"><BlockStack gap="400">
    {data.error && <Banner tone="warning">{data.error}</Banner>}
    {!data.configured && <Banner tone="info">Plan management is not available yet. Contact BookNest support to activate billing.</Banner>}
    <Card><BlockStack gap="400"><h2>Current plan</h2><p>{data.status === "ACTIVE" ? plans.find(p => p.id === data.plan)?.title ?? data.plan : data.status === "INACTIVE" ? "Choose a plan to get started" : data.status === "UNRECOGNIZED" ? "Your plan needs review. Contact BookNest support." : "Not verified"}</p>
      {"cancelAtEndOfCycle" in data && data.cancelAtEndOfCycle && <p>Your subscription is scheduled to end after the current billing cycle.</p>}
      {data.pricingUrl && <a className="bn-primary-link" href={data.pricingUrl} target="_top">Manage plan in Shopify</a>}
      <Form method="get"><Button submit disabled={navigation.state !== "idle"} loading={navigation.state !== "idle"}>Refresh plan status</Button></Form>
    </BlockStack></Card>
    <div className="bn-form-grid">{plans.map(plan => <Card key={plan.id}><h2>{plan.title}</h2><p className="bn-metric">${plan.monthly}<small> USD / month</small></p><p>Review plan details and confirm any charge in Shopify.</p></Card>)}</div>
    <Card><h2>Team Portal</h2><p>{data.seats} active team seat(s).</p><p>{data.seatBilling ? "$8 USD per active seat per billing cycle, billed through Shopify. Removing access stops future-cycle charges; current-cycle charges are not prorated." : "Team Portal is in testing. No seat charges are submitted."}</p></Card>
  </BlockStack></Page>;
}
