import { DateTime } from "luxon";
import { z } from "zod";
import { redirect, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Page, Card, BlockStack, Text } from "@shopify/polaris";
import { requireShop } from "../lib/auth/admin.server";
import { RecordAction } from "../components/Fields";
export async function loader({ request }: LoaderFunctionArgs) {
  const { db } = await requireShop(request);
  const [webhooks, notifications, seatUsage] = await Promise.all([
    db.webhookReceipt.findMany({ where: { processedAt: null, lastError: { not: null } }, select: { id: true, topic: true, lastError: true, attempts: true, createdAt: true }, orderBy: { createdAt: "asc" }, take: 100 }),
    db.notificationTask.findMany({ where: { completedAt: null, lastError: { not: null } }, select: { id: true, kind: true, lastError: true, attempts: true, runAt: true }, orderBy: { runAt: "asc" }, take: 100 }),
    db.seatUsage.findMany({ where: { submittedAt: null, lastError: { not: null } }, select: { id: true, lastError: true, attempts: true }, orderBy: { occurredAt: "asc" }, take: 100 }),
  ]);
  return { webhooks, notifications, seatUsage };
}
export async function action({ request }: ActionFunctionArgs) {
  const { db } = await requireShop(request); const form = await request.formData();
  const id = z.string().uuid().parse(form.get("id"));
  const intent = z.enum(["retry-webhook", "retry-email", "retry-billing"]).parse(form.get("intent"));
  if (intent === "retry-webhook") await db.webhookReceipt.update({ where: { id, processedAt: null }, data: { attempts: 0, lastError: null } });
  else if (intent === "retry-billing") await db.seatUsage.update({ where: { id, submittedAt: null }, data: { attempts: 0, lastError: null } });
  else await db.notificationTask.update({ where: { id, completedAt: null }, data: { attempts: 0, lastError: null, runAt: DateTime.utc().toJSDate() } });
  return redirect("/app/support");
}
export default function Support() {
  const { webhooks, notifications, seatUsage } = useLoaderData<typeof loader>();
  return <Page title="Support"><BlockStack gap="400">
    <Card><Text as="h2" variant="headingMd">Order updates requiring attention</Text>
      {!webhooks.length && <p>No failed order updates.</p>}
      {webhooks.map(item => <article className="bn-record" key={item.id}><div><strong>{item.topic.replaceAll("_", " ")}</strong><p>{item.lastError}</p><p>{item.attempts} attempts</p></div>
        <RecordAction id={item.id} intent="retry-webhook">Retry</RecordAction></article>)}
    </Card>
    <Card><Text as="h2" variant="headingMd">Messages and calendar updates waiting for retry</Text>
      {!notifications.length && <p>No failed messages or calendar updates.</p>}
      {notifications.map(item => <article className="bn-record" key={item.id}><div><strong>{item.kind.replaceAll("_", " ")}</strong><p>{item.lastError}</p></div>
        <RecordAction id={item.id} intent="retry-email">Retry</RecordAction></article>)}
    </Card>
    <Card><Text as="h2" variant="headingMd">Team seat reports waiting for retry</Text>
      {!seatUsage.length && <p>No failed seat reports.</p>}
      {seatUsage.map(item => <article className="bn-record" key={item.id}><p>{item.lastError}</p><RecordAction id={item.id} intent="retry-billing">Retry</RecordAction></article>)}
      <p>Shopify billing shows final charges. Retrying a report uses the same reference to prevent duplicate charges.</p>
    </Card>
  </BlockStack></Page>;
}
