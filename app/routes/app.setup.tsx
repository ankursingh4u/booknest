import { DateTime } from "luxon";
import { Form, Link, redirect, useActionData, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Page, Card, BlockStack, Badge, Banner, Button } from "@shopify/polaris";
import { requireShop } from "../lib/auth/admin.server";
import { setupSteps, setupError } from "../lib/onboarding/setup";
import { AdminCheckbox } from "../components/AdminFields";
async function progress(request: Request) {
  const { shop, db } = await requireShop(request);
  const [settings, services] = await Promise.all([
    db.shop.findUniqueOrThrow({ where: { id: shop.id }, select: { email: true, timezone: true, onboardedAt: true } }),
    db.service.count({ where: { active: true, location: { active: true }, staff: { some: { staff: { active: true } } } } }),
  ]);
  return { shop, db, settings, services };
}
export async function loader({ request }: LoaderFunctionArgs) {
  const { shop, settings, services } = await progress(request);
  return { domain: shop.domain, settings, services };
}
export async function action({ request }: ActionFunctionArgs) {
  const { shop, db, settings, services } = await progress(request);
  const form = await request.formData();
  const error = setupError({ email: settings.email, services, tested: form.get("tested") === "yes" });
  if (error) return { error };
  await db.shop.update({ where: { id: shop.id }, data: { onboardedAt: DateTime.utc().toJSDate() } });
  return redirect("/app");
}
export default function Setup() {
  const { domain, settings, services } = useLoaderData<typeof loader>(), result = useActionData<typeof action>();
  const steps = setupSteps({ email: settings.email, services });
  return <Page title="Set up BookNest" subtitle="Complete these steps before taking your first booking"><BlockStack gap="400">
    {result && <Banner tone="critical">{result.error}</Banner>}{settings.onboardedAt && <Banner tone="success">Setup was marked complete. You can revisit these steps anytime.</Banner>}
    {steps.map((step, i) => <Card key={step.url}><BlockStack gap="400"><div className="bn-heading-row"><h2>{i + 1}. {step.title}</h2><Badge tone={step.done ? "success" : "attention"}>{step.done ? "Ready" : "To do"}</Badge></div><p>{step.text}</p><Link to={step.url}>Open step</Link></BlockStack></Card>)}
    <Card><BlockStack gap="400"><h2>{steps.length + 1}. Add the booking widget</h2><p>Open a product template in your theme editor. Add the BookNest booking app block, choose Inline or Popup and a theme, then save. For free bookings or a dedicated service page, enter the Event/Service ID in the block settings.</p>
      <a className="bn-primary-link" href={"https://" + domain + "/admin/themes/current/editor"} target="_blank" rel="noreferrer">Open theme editor</a>
      <p>Create a test booking on your storefront, check it appears in BookNest, and verify the confirmation email. For paid bookings, use your development store's test checkout.</p>
      <Form method="post" className="bn-form"><AdminCheckbox name="tested" value="yes" label="I tested a storefront booking successfully." /><Button submit variant="primary">Finish setup</Button></Form>
    </BlockStack></Card>
    <Card><div className="bn-heading-row"><Link to="/app/calendar">Connect Google Calendar</Link><Link to="/app/intake">Add intake questions</Link><Link to="/app/notifications">Customize notifications</Link><Link to="/app/team">Invite your team</Link></div></Card>
  </BlockStack></Page>;
}
