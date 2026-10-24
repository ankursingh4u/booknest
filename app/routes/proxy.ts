import { DateTime } from "luxon";
import { z } from "zod";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { findShopIdentity, getShopDatabase } from "../db.server";
import { createBooking, createReservation, joinWaitlist, listDaySlots, listMonthAvailability } from "../lib/bookings/service.server";
import { BookingError } from "../lib/bookings/validation";
import { depositCheckout } from "../lib/bookings/deposit.server";
import { paymentDue, reservationProperties } from "../lib/bookings/checkout";
import { verifyBookingVariant } from "../lib/shopify/variant.server";
import { requireActivePlan } from "../lib/billing/service.server";
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
async function context(request: Request) {
  const auth = await authenticate.public.appProxy(request);
  if (!auth.session || !auth.admin) throw new Response("Store is not connected.", { status: 404 });
  const shop = await findShopIdentity(auth.session.shop);
  if (!shop) throw new Response("Store is not connected.", { status: 404 });
  await requireActivePlan(shop.id, shop.domain, auth.admin);
  return { shop, db: getShopDatabase(shop.id), admin: auth.admin };
}
async function body(request: Request) {
  if (!request.headers.get("Content-Type")?.includes("application/json")) throw new BookingError("Send JSON data.", 415);
  const reader = request.body?.getReader();
  if (!reader) throw new BookingError("Request body is required.", 400);
  let size = 0; const chunks: Uint8Array[] = [];
  try {
    for (;;) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength;
      if (size > 65536) { await reader.cancel(); throw new BookingError("Request is too large.", 413); } chunks.push(chunk.value); }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch (error) { if (error instanceof BookingError) throw error; throw new BookingError("Invalid JSON.", 400); }
}
function failure(error: unknown) {
  if (error instanceof Response) throw error;
  if (error instanceof BookingError) return json({ error: error.message }, error.status);
  if (error instanceof z.ZodError) return json({ error: error.issues[0]?.message ?? "Invalid request." }, 400);
  console.error("BookNest storefront request failed");
  return json({ error: "Booking could not be completed. Please try again." }, 500);
}
export async function loader({ request, params }: LoaderFunctionArgs) {
  try {
    const { shop, db } = await context(request);
    const url = new URL(request.url);
    if (params.endpoint === "slots") return json(await listDaySlots(shop.id, z.string().min(1).max(100).parse(url.searchParams.get("serviceId")),
      z.string().parse(url.searchParams.get("date")), z.coerce.number().int().min(1).max(1000).parse(url.searchParams.get("quantity") ?? 1), undefined, undefined, url.searchParams.get("timezone") || undefined));
    if (params.endpoint === "calendar") return json(await listMonthAvailability(shop.id, z.string().min(1).max(100).parse(url.searchParams.get("serviceId")),
      z.string().parse(url.searchParams.get("month")), z.coerce.number().int().min(1).max(1000).parse(url.searchParams.get("quantity") ?? 1), url.searchParams.get("timezone") || undefined));
    if (params.endpoint !== "catalog") return json({ error: "Not found." }, 404);
    const serviceId = url.searchParams.get("serviceId");
    const variant = url.searchParams.get("variantId");
    // `variantIds` lets the storefront widget match every variant of a product at once, so the
    // booking widget shows from whichever variant/colour the shopper has selected.
    const variantGids = (url.searchParams.get("variantIds") || "").split(",").map(id => id.trim()).filter(id => /^\d+$/.test(id)).map(id => "gid://shopify/ProductVariant/" + id);
    const settings = await db.shop.findUniqueOrThrow({ where: { id: shop.id }, select: { timezone: true, currency: true } });
    const services = await db.service.findMany({ where: { active: true, ...(serviceId ? { id: serviceId } : variantGids.length ? { variantId: { in: variantGids } } : variant ? { variantId: "gid://shopify/ProductVariant/" + variant } : {}),
      location: { active: true, shopId: shop.id } }, take: 100,
      select: { id: true, title: true, description: true, durationMin: true, maxAdvanceDays: true, capacity: true, priceCents: true, variantId: true, depositType: true, depositValue: true,
        location: { select: { timezone: true, name: true } }, questions: { where: { active: true }, select: { id: true, label: true, type: true, required: true, options: true }, orderBy: { sortOrder: "asc" } } } });
    return json({ currency: settings.currency, services: services.map(service => ({ ...service, timezone: service.location.timezone, locationName: service.location.name, dueCents: paymentDue(service),
      today: DateTime.now().setZone(service.location.timezone).toISODate(), lastDate: DateTime.now().setZone(service.location.timezone).plus({ days: service.maxAdvanceDays }).toISODate() })) });
  } catch (error) { return failure(error); }
}
export async function action({ request, params }: ActionFunctionArgs) {
  try {
    const { shop, db, admin } = await context(request);
    const values = await body(request);
    if (params.endpoint === "bookings") {
      const parsed = z.object({ booking: z.unknown(), customer: z.unknown() }).parse(values);
      const booking = await createBooking(shop.id, parsed.booking, parsed.customer, "free");
      return json({ id: booking.id, startAt: booking.startAt, endAt: booking.endAt, status: booking.status });
    }
    if (params.endpoint === "waitlist") { const entry = await joinWaitlist(shop.id, values); return json({ id: entry.id }, 201); }
    if (params.endpoint !== "holds") return json({ error: "Not found." }, 404);
    const hold = await createReservation(shop.id, values, undefined, (id, cents) => verifyBookingVariant(admin, id, cents));
    if (["FIXED", "PERCENT"].includes(hold.depositType)) return json({ reservationId: hold.id, expiresAt: hold.expiresAt, checkoutUrl: await depositCheckout(shop.id, hold.id, admin) });
    const [location, staff] = await Promise.all([
      db.location.findUniqueOrThrow({ where: { id: hold.locationId }, select: { timezone: true } }),
      db.staffMember.findUniqueOrThrow({ where: { id: hold.staffId }, select: { firstName: true, lastName: true } }),
    ]);
    return json({ reservationId: hold.id, expiresAt: hold.expiresAt, item: { id: hold.variantId?.split("/").pop(), quantity: hold.quantity,
      properties: reservationProperties(hold, location.timezone, staff.firstName + " " + staff.lastName) } });
  } catch (error) { return failure(error); }
}
