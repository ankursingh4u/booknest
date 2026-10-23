import { useLoaderData, useNavigate } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { Page, Card, BlockStack, Badge, Button } from "@shopify/polaris";
import { requireShop } from "../lib/auth/admin.server";
import { setupSteps } from "../lib/onboarding/setup";
export async function loader({ request }: LoaderFunctionArgs) {
  const { shop, db } = await requireShop(request);
  const [settings, services] = await Promise.all([
    db.shop.findUniqueOrThrow({ where: { id: shop.id }, select: { email: true } }),
    db.service.count({ where: { active: true, location: { active: true }, staff: { some: { staff: { active: true } } } } }),
  ]);
  return { domain: shop.domain, email: settings.email, services };
}
export default function Setup() {
  const { domain, email, services } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const steps = setupSteps({ email, services });
  return <Page title="Set up BookNest" subtitle="Complete these steps before taking your first booking"><BlockStack gap="400">
    {steps.map((step, i) => <Card key={step.url}><BlockStack gap="400">
      <div className="bn-heading-row"><h2>{i + 1}. {step.title}</h2><Badge tone={step.done ? "success" : "attention"}>{step.done ? "Ready" : "To do"}</Badge></div>
      <p>{step.text}</p>
      <div><Button onClick={() => navigate(step.url)}>Open step</Button></div>
    </BlockStack></Card>)}
    <Card><BlockStack gap="400">
      <h2>{steps.length + 1}. Add the booking widget</h2>
      <p>Open a product template in your theme editor. Add the BookNest booking app block, choose Inline or Popup and a theme, then save. For free bookings or a dedicated service page, enter the Event/Service ID in the block settings.</p>
      <div><Button variant="primary" url={"https://" + domain + "/admin/themes/current/editor"} target="_blank">Open theme editor</Button></div>
      <p>Create a test booking on your storefront, check it appears in BookNest, and verify the confirmation email. For paid bookings, use your development store's test checkout.</p>
    </BlockStack></Card>
    <Card><BlockStack gap="400">
      <h2>Connect Google Calendar</h2>
      <p>Sync confirmed bookings to a Google Calendar so your availability stays up to date.</p>
      <div><Button onClick={() => navigate("/app/calendar")}>Connect Google Calendar</Button></div>
    </BlockStack></Card>
  </BlockStack></Page>;
}
