import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import { z } from "zod";
import { Form, Link, redirect, useActionData, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Page, Card, BlockStack, Text, Banner } from "@shopify/polaris";
import { requireShop } from "../lib/auth/admin.server";
import { createBooking, listDaySlots, rescheduleBooking } from "../lib/bookings/service.server";
import { BookingError } from "../lib/bookings/validation";
import { formError } from "../lib/admin/errors.server";
import { Field, SelectField, SaveButton } from "../components/Fields";
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { shop, db } = await requireShop(request);
  const url = new URL(request.url);
  const [services, settings, booking] = await Promise.all([
    db.service.findMany({ where: { active: true }, select: { id: true, title: true }, orderBy: { title: "asc" } }),
    db.shop.findUniqueOrThrow({ where: { id: shop.id }, select: { timezone: true } }),
    params.bookingId ? db.booking.findUnique({ where: { id: params.bookingId }, select: { id: true, serviceId: true, quantity: true, customerName: true, customerEmail: true, status: true } }) : null,
  ]);
  if (params.bookingId && !booking) throw new Response("Booking not found.", { status: 404 });
  const serviceId = booking?.serviceId ?? url.searchParams.get("serviceId") ?? "";
  const date = url.searchParams.get("date") ?? DateTime.now().setZone(settings.timezone).toISODate()!;
  const quantity = booking?.quantity ?? z.coerce.number().int().min(1).max(1000).parse(url.searchParams.get("quantity") ?? 1);
  const availability = serviceId ? await listDaySlots(shop.id, serviceId, date, quantity, undefined, booking?.id) : null;
  const questions = serviceId ? await db.intakeQuestion.findMany({ where: { serviceId, active: true }, orderBy: { sortOrder: "asc" } }) : [];
  return { services, serviceId, date, quantity, availability, questions, booking, requestId: randomUUID() };
}
export async function action({ request, params }: ActionFunctionArgs) {
  const { shop } = await requireShop(request);
  const form = await request.formData();
  try {
    const selection = z.string().min(1).parse(form.get("slot"));
    let slot: unknown;
    try { slot = JSON.parse(selection); } catch { throw new BookingError("Choose a valid time.", 400); }
    const parsed = z.object({ staffId: z.string(), startAt: z.string() }).parse(slot);
    const input = { ...parsed, serviceId: form.get("serviceId"), quantity: form.get("quantity"), idempotencyKey: form.get("idempotencyKey") };
    if (params.bookingId) await rescheduleBooking(shop.id, params.bookingId, input, undefined, form.get("reviewed") === "yes" ? { email: form.get("reviewEmail"), name: form.get("reviewName") } : undefined);
    else await createBooking(shop.id, input, { email: form.get("email"), name: form.get("name"), phone: form.get("phone") || undefined, notes: form.get("notes") || undefined,
      answers: [...form.entries()].filter(([key]) => key.startsWith("answer:")).map(([key, value]) => ({ questionId: key.slice(7), value })) }, "manual");
    return redirect("/app?saved=1");
  } catch (error) { return formError(error); }
}
export default function BookingForm() {
  const { services, serviceId, date, quantity, availability, questions, booking, requestId } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  return <Page title={booking ? "Reschedule booking" : "Add a booking"} backAction={{ content: "Bookings", url: "/app" }}><BlockStack gap="400">
    {result && <Banner tone="critical">{result.error}{Object.values(result.fields).flat().map((error, index) => <p key={index}>{error}</p>)}</Banner>}
    {booking && <Banner>{booking.customerName} · {booking.customerEmail}</Banner>}
    <Card><Form method="get" className="bn-form">
      <SelectField name="serviceId" label="Event/Service" value={serviceId} options={services.map(service => ({ value: service.id, label: service.title }))} required />
      <div className="bn-form-grid"><Field name="date" label="Date" type="date" value={date} required />
      <Field name="quantity" label="Number of guests" type="number" value={quantity} required /></div><SaveButton>Find times</SaveButton>
    </Form></Card>
    {availability && <Card><Form method="post" className="bn-form" key={serviceId + date + quantity}>
      <Text as="h2" variant="headingMd">Choose a time · {availability.timezone}</Text>
      <input type="hidden" name="serviceId" value={serviceId} /><input type="hidden" name="quantity" value={quantity} /><input type="hidden" name="idempotencyKey" value={requestId} />
      <fieldset className="bn-options bn-slot-grid"><legend>Available times</legend>
        {availability.slots.map(slot => <label key={slot.startAt + slot.staffId}><input type="radio" name="slot" required value={JSON.stringify({ startAt: slot.startAt, staffId: slot.staffId })} />
          {slot.label} · {slot.staffName} · {slot.remaining} left</label>)}
        {!availability.slots.length && <p>No times available. Choose another date or check <Link to="/app/schedules">working hours</Link>.</p>}
      </fieldset>
      {booking?.status === "NEEDS_REVIEW" && <><Banner tone="warning">Review the Shopify order, payment, product, and guest count before confirming this appointment. This action keeps the recorded payment and order reference.</Banner>
        <Field name="reviewName" label="Customer name" value={booking.customerName ?? ""} required /><Field name="reviewEmail" label="Customer email" type="email" value={booking.customerEmail} required />
        <label><input type="checkbox" name="reviewed" value="yes" required /> I reviewed the order and agree to confirm this booking at the selected time.</label>
      </>}
      {!booking && <><div className="bn-form-grid"><Field name="name" label="Customer name" required /><Field name="email" label="Customer email" type="email" required /></div>
        <Field name="phone" label="Phone" type="tel" /><Field name="notes" label="Notes" type="textarea" />
        {questions.map(question => question.options.length ? <SelectField key={question.id} name={"answer:" + question.id} label={question.label} required={question.required}
          options={question.options.map(value => ({ value, label: value }))} /> : <Field key={question.id} name={"answer:" + question.id} label={question.label} required={question.required} />)}
        <p>For paid services, collect any payment separately when adding a manual booking.</p>
      </>}
      {availability.slots.length > 0 && <SaveButton>{booking ? "Save new time" : "Confirm booking"}</SaveButton>}
    </Form></Card>}
  </BlockStack></Page>;
}
