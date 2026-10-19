import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Page, Card, BlockStack, Banner, Button } from "@shopify/polaris";
import { requireShop } from "../lib/auth/admin.server";
import { insightData, generateInsight } from "../lib/insights/service.server";
export async function loader({ request }: LoaderFunctionArgs) { const { shop } = await requireShop(request); return insightData(shop.id); }
export async function action({ request }: ActionFunctionArgs) { const { shop } = await requireShop(request); return generateInsight(shop.id); }
export default function Insights() {
  const { current, previous, start, end, timezone, top, insight, aiAvailable } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>(), navigation = useNavigation();
  const money = (value: number, currency: string) => new Intl.NumberFormat(undefined, { style: "currency", currency }).format(value / 100);
  return <Page title="Booking insights"><BlockStack gap="400">
    <p>{start} to {end} · {timezone} · compared with the preceding 30 days</p>
    {result && !result.generated && <Banner tone="info">AI summary is unavailable. The summary below uses your booking metrics.</Banner>}
    <Card><BlockStack gap="400"><h2>{insight.model === "rules-v1" ? "Booking summary" : "AI summary"}</h2><ul>{insight.highlights.map((line, i) => <li key={i}>{line}</li>)}</ul><p>{insight.nudge}</p>
      {aiAvailable && insight.model === "rules-v1" && <Form method="post"><Button submit variant="primary" disabled={navigation.state !== "idle"} loading={navigation.state !== "idle"}>{navigation.state === "idle" ? "Generate today's AI summary" : "Generating…"}</Button><p>Uses aggregate counts and amounts. Customer details are excluded.</p></Form>}
      {insight.model !== "rules-v1" && <p>Generated once per day. Review suggestions before acting on them.</p>}
    </BlockStack></Card>
    <div className="bn-form-grid"><Card><h2>Bookings</h2><p className="bn-metric">{current.bookings}</p><p>{previous.bookings} in the preceding period · {current.guests} guests</p></Card>
      <Card><h2>Cancellations</h2><p className="bn-metric">{current.cancellationRate}%</p><p>{current.status.CANCELLED ?? 0} cancelled bookings</p></Card>
      <Card><h2>No-shows</h2><p className="bn-metric">{current.noShowRate}%</p><p>Among bookings marked completed or no-show</p></Card>
      <Card><h2>Needs review</h2><p className="bn-metric">{current.status.NEEDS_REVIEW ?? 0}</p><p>Paid bookings needing merchant attention in this period</p></Card>
    </div>
    <Card><BlockStack gap="400"><h2>Booking amounts</h2>{Object.entries(current.money).map(([currency, value]) => <div key={currency}><strong>{currency}</strong><p>Booked value: {money(value.bookedCents, currency)}</p><p>Payments recorded: {money(value.recordedPaymentsCents, currency)}</p></div>)}
      {!Object.keys(current.money).length && <p>No booking amounts in this period.</p>}<p>Payments are recorded before refunds. Booked value excludes cancellations, pending bookings, and bookings needing review. Use Shopify for financial reconciliation.</p>
    </BlockStack></Card>
    <Card><BlockStack gap="400"><h2>Most booked Events/Services</h2>{top.map((row, i) => <article className="bn-record" key={i}><strong>{row.title}</strong><p>{row.bookings} bookings · {row.guests} guests</p></article>)}{!top.length && <p>No confirmed bookings in this period.</p>}</BlockStack></Card>
  </BlockStack></Page>;
}
