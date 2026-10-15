import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import { z } from "zod";
import { Form, redirect, useActionData, useLoaderData } from "react-router";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { getShopDatabase, resolveCustomerBooking } from "../db.server";
import { cancelBooking, listDaySlots, rescheduleBooking } from "../lib/bookings/service.server";
import { Field, SaveButton } from "../components/Fields";
import { BookingError } from "../lib/bookings/validation";
import { customerChangeError } from "../lib/bookings/policy";
export const headers: HeadersFunction = () => ({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" });
async function authorized(token: string | undefined) {
  const booking = await resolveCustomerBooking(token ?? "");
  if (!booking) throw new Response("Booking link not found.", { status: 404 });
  const policy = await getShopDatabase(booking.shopId).service.findUniqueOrThrow({
    where: { id: booking.serviceId }, select: { customerCancelCutoffHours: true, customerRescheduleCutoffHours: true },
  });
  return { ...booking, policy };
}
export async function loader({ request, params }: LoaderFunctionArgs) {
  const booking = await authorized(params.token);
  const now = DateTime.utc();
  const start = DateTime.fromJSDate(booking.startAt, { zone: "utc" });
  const changeErrors = {
    cancel: customerChangeError(start, booking.policy, "cancel", now),
    reschedule: customerChangeError(start, booking.policy, "reschedule", now),
  };
  const date = new URL(request.url).searchParams.get("date") ?? "";
  const slots = booking.status === "CONFIRMED" && !changeErrors.reschedule && date
    ? await listDaySlots(booking.shopId, booking.serviceId, date, booking.quantity, undefined, booking.id) : null;
  return { booking: { customerName: booking.customerName, service: booking.service.title, location: booking.location.name, timezone: booking.location.timezone,
    startAt: booking.startAt.toISOString(), status: booking.status }, date, slots, policy: booking.policy, changeErrors, requestId: randomUUID() };
}
export async function action({ request, params }: ActionFunctionArgs) {
  const booking = await authorized(params.token);
  const form = await request.formData();
  try {
    if (booking.status !== "CONFIRMED") throw new BookingError("This booking cannot be changed. Please contact the store.");
    const intent = z.enum(["cancel", "reschedule"]).parse(form.get("intent"));
    const now = DateTime.utc();
    const rejection = customerChangeError(DateTime.fromJSDate(booking.startAt, { zone: "utc" }), booking.policy, intent, now);
    if (rejection) throw new BookingError(rejection);
    if (intent === "cancel") await cancelBooking(booking.shopId, booking.id, { customer: true });
    else {
      let selection: unknown; try { selection = JSON.parse(String(form.get("slot"))); } catch { throw new BookingError("Choose a time.", 400); }
      const slot = z.object({ staffId: z.string(), startAt: z.string() }).parse(selection);
      await rescheduleBooking(booking.shopId, booking.id, { ...slot, serviceId: booking.serviceId, quantity: booking.quantity, idempotencyKey: form.get("idempotencyKey") }, now, undefined, { customer: true });
    }
    return redirect("/booking/" + params.token);
  } catch (error) {
    if (error instanceof BookingError) return { error: error.message };
    if (error instanceof z.ZodError) return { error: "Please choose a valid time." };
    throw error;
  }
}
export default function BookingPortal() {
  const { booking, date, slots, requestId, policy, changeErrors } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  return <main className="bn-login"><section className="bn-login-card bn-form">
    <p className="bn-eyebrow">BookNest</p><h1>Your booking</h1>
    {result && <p role="alert">{result.error}</p>}
    <h2>{booking.service}</h2><p>{DateTime.fromISO(booking.startAt).setZone(booking.timezone).toFormat("cccc, dd LLL yyyy · h:mm a ZZZZ")}</p>
    <p>{booking.location} · {booking.status.replaceAll("_", " ")}</p>
    {booking.status === "CONFIRMED" && <>
      {policy.customerCancelCutoffHours > 0 && <p>Online cancellation closes {policy.customerCancelCutoffHours} hour(s) before your appointment.</p>}
      {policy.customerRescheduleCutoffHours > 0 && <p>Online rescheduling closes {policy.customerRescheduleCutoffHours} hour(s) before your appointment.</p>}
      {changeErrors.reschedule ? <p>{changeErrors.reschedule}</p> : <Form method="get" className="bn-form"><Field name="date" label="Choose a different date" type="date" value={date} required /><SaveButton>Find times</SaveButton></Form>}
      {slots && !changeErrors.reschedule && <Form method="post" className="bn-form"><input type="hidden" name="intent" value="reschedule" /><input type="hidden" name="idempotencyKey" value={requestId} />
        <fieldset className="bn-options"><legend>Available times · {slots.timezone}</legend>
          {slots.slots.map(slot => <label key={slot.staffId + slot.startAt}><input required type="radio" name="slot" value={JSON.stringify({ staffId: slot.staffId, startAt: slot.startAt })} />{slot.label} · {slot.staffName}</label>)}
          {!slots.slots.length && <p>No times available on this date.</p>}
        </fieldset>{slots.slots.length > 0 && <SaveButton>Confirm new time</SaveButton>}
      </Form>}
      {changeErrors.cancel ? changeErrors.cancel !== changeErrors.reschedule && <p>{changeErrors.cancel}</p> : <details><summary>Cancel this booking</summary><p>Contact the store about any refund.</p><Form method="post"><input type="hidden" name="intent" value="cancel" /><SaveButton>Confirm cancellation</SaveButton></Form></details>}
    </>}
  </section></main>;
}
