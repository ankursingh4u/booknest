import { useState } from "react";
import { Form, redirect, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Page, Card, BlockStack, Text, Banner, Badge, Button } from "@shopify/polaris";
import { useAppBridge } from "@shopify/app-bridge-react";
import { requireShop } from "../lib/auth/admin.server";
import { AdminSaveButton as SaveButton } from "../components/AdminFields";
import { withShopTransaction } from "../db.server";
export async function loader({ request }: LoaderFunctionArgs) {
  const { shop, db } = await requireShop(request);
  const record = await db.shop.findUniqueOrThrow({ where: { id: shop.id }, select: { googleCalendarId: true, googleSyncError: true } });
  return { connected: Boolean(record.googleCalendarId), syncError: record.googleSyncError, shop: shop.domain,
    configured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REDIRECT_URI) };
}
export async function action({ request }: ActionFunctionArgs) {
  const { shop } = await requireShop(request);
  await withShopTransaction(shop.id, async tx => {
    await tx.shop.update({ where: { id: shop.id }, data: { googleRefreshToken: null, googleCalendarId: null, googleSyncError: null } });
    await tx.booking.updateMany({ where: { googleEventId: { not: null } }, data: { googleEventId: null, googleEventCalendarId: null } });
  });
  return redirect("/app/calendar");
}
export default function Calendar() {
  const { connected, syncError, shop, configured } = useLoaderData<typeof loader>(); const bridge = useAppBridge();
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function connect() {
    setBusy(true); setError("");
    try { const token = await bridge.idToken(); const url = new URL("/auth/google/start", window.location.origin);
      url.search = new URLSearchParams({ shop, id_token: token }).toString(); window.open(url.href, "_top");
    } catch { setError("Could not start the calendar connection. Reopen BookNest from Shopify and try again."); setBusy(false); }
  }
  return <Page title="Google Calendar" subtitle="One calendar for the whole store — every booking syncs to it"><BlockStack gap="400">
    {!configured && <Banner tone="warning">Google Calendar connection needs application configuration.</Banner>}
    {error && <Banner tone="critical">{error}</Banner>}
    <Card><BlockStack gap="400"><Text as="h2" variant="headingMd">Store calendar</Text>
      <Badge tone={connected ? "success" : undefined}>{connected ? "Connected" : "Not connected"}</Badge>
      {syncError && <Banner tone="warning">{syncError}</Banner>}
      <p>Connect once and every booking — for every Availability — is added to this Google Calendar. Busy events on it also block new bookings.</p>
      <Button variant="primary" disabled={!configured || busy} loading={busy} onClick={() => void connect()}>{connected ? "Reconnect calendar" : "Connect calendar"}</Button>
      {connected && <details><summary>Disconnect</summary><p>Sync will stop. Existing BookNest events will remain in Google Calendar until you remove them there.</p>
        <Form method="post"><SaveButton>Disconnect calendar</SaveButton></Form></details>}
    </BlockStack></Card>
  </BlockStack></Page>;
}
