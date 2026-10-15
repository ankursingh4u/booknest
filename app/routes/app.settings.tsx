import { z } from "zod";
import { Form, redirect, useActionData, useLoaderData, useSearchParams } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Page, Card, BlockStack, Text, Banner } from "@shopify/polaris";
import { requireShop } from "../lib/auth/admin.server";
import { timezoneSchema } from "../lib/admin/schemas";
import { formError } from "../lib/admin/errors.server";
import { syncShopProfile } from "../lib/shopify/profile.server";
import { Field, SaveButton } from "../components/Fields";
export async function loader({ request }: LoaderFunctionArgs) {
  const { db, shop } = await requireShop(request);
  return { settings: await db.shop.findUniqueOrThrow({ where: { id: shop.id }, select: { domain: true, timezone: true, email: true, currency: true, plan: true } }),
    emailConfigured: Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM) };
}
export async function action({ request }: ActionFunctionArgs) {
  const { shop, db, admin } = await requireShop(request);
  const form = await request.formData();
  try {
    if (form.get("intent") === "sync") await syncShopProfile(shop.id, admin);
    else {
      const values = z.object({ timezone: timezoneSchema, email: z.string().trim().email().max(254) }).parse(Object.fromEntries(form));
      await db.shop.update({ where: { id: shop.id }, data: values });
    }
    return redirect("/app/settings?saved=1");
  } catch (error) { return formError(error); }
}
export default function Settings() {
  const { settings, emailConfigured } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>(); const [search] = useSearchParams();
  return <Page title="Settings"><BlockStack gap="400">
    {result && <Banner tone="critical">{result.error}{Object.values(result.fields).flat().map((error, i) => <p key={i}>{error}</p>)}</Banner>}
    {search.has("saved") && <Banner tone="success">Store settings saved.</Banner>}
    <Card><Form method="post" className="bn-form"><Text as="h2" variant="headingMd">Store preferences</Text>
      <p>{settings.domain} · {settings.currency}</p><Field name="timezone" label="Default timezone" value={settings.timezone} required />
      <Field name="email" label="Store contact email" type="email" value={settings.email ?? ""} required help="Used for replies and customer data requests." />
      <SaveButton>Save preferences</SaveButton>
    </Form><Form method="post"><input type="hidden" name="intent" value="sync" /><SaveButton>Refresh store details from Shopify</SaveButton></Form></Card>
    <Card><BlockStack gap="400"><Text as="h2" variant="headingMd">Storefront</Text>
      <p>Add the BookNest booking app block to your product template. The widget uses the Event/Service linked to the product variant.</p>
      <a href={"https://" + settings.domain + "/admin/themes/current/editor"} target="_blank" rel="noreferrer">Open theme editor</a>
    </BlockStack></Card>
    <Card><BlockStack gap="400"><Text as="h2" variant="headingMd">Email notifications</Text>
      <p>{emailConfigured ? "Confirmation, reschedule, cancellation, and reminder emails are configured." : "Email delivery needs sender configuration before customers can receive booking messages."}</p>
    </BlockStack></Card>
  </BlockStack></Page>;
}
