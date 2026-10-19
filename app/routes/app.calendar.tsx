import { useState } from "react";
import { Form, redirect, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Page, Card, BlockStack, Text, Banner, Badge, Button } from "@shopify/polaris";
import { useAppBridge } from "@shopify/app-bridge-react";
import { z } from "zod";
import { requireShop } from "../lib/auth/admin.server";
import { AdminSaveButton as SaveButton } from "../components/AdminFields";
import { withShopTransaction } from "../db.server";
export async function loader({ request }: LoaderFunctionArgs) {
  const { shop, db } = await requireShop(request);
  const staff = await db.staffMember.findMany({ where: { active: true }, select: { id: true, firstName: true, lastName: true, googleCalendarId: true, googleSyncError: true } });
  return { staff, shop: shop.domain, configured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REDIRECT_URI) };
}
export async function action({ request }: ActionFunctionArgs) {
  const { shop } = await requireShop(request); const form = await request.formData();
  const id = z.string().min(1).max(100).parse(form.get("staffId"));
  await withShopTransaction(shop.id, async tx => {
    await tx.staffMember.update({ where: { id }, data: { googleRefreshToken: null, googleCalendarId: null, googleSyncError: null } });
    await tx.booking.updateMany({ where: { googleEventStaffId: id }, data: { googleEventId: null, googleEventStaffId: null, googleEventCalendarId: null } });
  }, [id]);
  return redirect("/app/calendar");
}
export default function Calendar() {
  const { staff, shop, configured } = useLoaderData<typeof loader>(); const bridge = useAppBridge();
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function connect(staffId: string) {
    setBusy(true); setError("");
    try { const token = await bridge.idToken(); const url = new URL("/auth/google/start", window.location.origin);
      url.search = new URLSearchParams({ staffId, shop, id_token: token }).toString(); window.open(url.href, "_top");
    } catch { setError("Could not start the calendar connection. Reopen BookNest from Shopify and try again."); setBusy(false); }
  }
  return <Page title="Google Calendar"><BlockStack gap="400">
    {!configured && <Banner tone="warning">Google Calendar connection needs application configuration.</Banner>}
    {error && <Banner tone="critical">{error}</Banner>}
    {staff.map(person => <Card key={person.id}><BlockStack gap="400"><Text as="h2" variant="headingMd">{person.firstName} {person.lastName}</Text>
      <Badge tone={person.googleCalendarId ? "success" : undefined}>{person.googleCalendarId ? "Connected" : "Not connected"}</Badge>
      {person.googleSyncError && <Banner tone="warning">{person.googleSyncError}</Banner>}
      <Button variant="primary" disabled={!configured || busy} loading={busy} onClick={() => void connect(person.id)}>{person.googleCalendarId ? "Reconnect calendar" : "Connect calendar"}</Button>
      {person.googleCalendarId && <details><summary>Disconnect</summary><p>Sync will stop. Existing BookNest events will remain in Google Calendar until you remove them there.</p>
        <Form method="post"><input type="hidden" name="staffId" value={person.id} /><SaveButton>Disconnect calendar</SaveButton></Form></details>}
    </BlockStack></Card>)}
    {!staff.length && <Card><p>Add an Availability before connecting a calendar.</p></Card>}
  </BlockStack></Page>;
}
