import { z } from "zod";
import { Form, redirect, useActionData, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Page, Card, BlockStack, Text, Banner } from "@shopify/polaris";
import { requireShop } from "../lib/auth/admin.server";
import { formError } from "../lib/admin/errors.server";
import { AdminField as Field, AdminSaveButton as SaveButton, AdminCheckbox } from "../components/AdminFields";
const kinds = ["CONFIRMATION", "RESCHEDULED", "CANCELLED", "REMINDER_24H", "REMINDER_1H"] as const;
export async function loader({ request }: LoaderFunctionArgs) {
  const { db } = await requireShop(request);
  return { templates: await db.notificationTemplate.findMany({ where: { channel: "email", type: { in: [...kinds] } } }) };
}
export async function action({ request }: ActionFunctionArgs) {
  const { db, shop } = await requireShop(request); const form = await request.formData();
  try {
    const values = z.object({ type: z.enum(kinds), subject: z.string().trim().min(1).max(200), body: z.string().trim().min(1).max(20000), enabled: z.boolean() })
      .parse({ ...Object.fromEntries(form), enabled: form.has("enabled") });
    await db.notificationTemplate.upsert({ where: { shopId_type_channel: { shopId: shop.id, type: values.type, channel: "email" } }, create: { ...values, shopId: shop.id, channel: "email" }, update: values });
    return redirect("/app/notifications");
  } catch (error) { return formError(error); }
}
export default function Notifications() {
  const { templates } = useLoaderData<typeof loader>(); const result = useActionData<typeof action>();
  return <Page title="Email notifications"><BlockStack gap="400">
    {result && <Banner tone="critical">{result.error}</Banner>}
    <Card><Text as="p">Use {"{{customer_name}}"}, {"{{service_name}}"}, {"{{start_time}}"}, {"{{location}}"}, {"{{staff_name}}"}, {"{{manage_url}}"}, and {"{{contact_link}}"} in your messages.</Text></Card>
    {kinds.map(kind => { const template = templates.find(item => item.type === kind);
      return <Card key={kind}><Form method="post" className="bn-form"><Text as="h2" variant="headingMd">{kind.replaceAll("_", " ")}</Text>
        <input type="hidden" name="type" value={kind} /><Field name="subject" label="Subject" value={template?.subject ?? kind.replaceAll("_", " ") + " · {{service_name}}"} required />
        <Field name="body" label="Message" type="textarea" value={template?.body ?? "Hi {{customer_name}},\n\n{{service_name}}\n{{start_time}}\n{{location}}\n\nManage your booking: {{manage_url}}\n{{contact_link}}"} required />
        <AdminCheckbox name="enabled" label="Send this email" defaultChecked={template?.enabled ?? true} /><SaveButton>Save message</SaveButton>
      </Form></Card>;
    })}
  </BlockStack></Page>;
}
