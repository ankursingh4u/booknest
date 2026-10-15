import { DateTime } from "luxon";
import { z } from "zod";
import { getShopDatabase, withShopTransaction } from "../../db.server";
import { availabilityForDay, cancelBooking } from "../bookings/service.server";
import { BookingError, customerInput } from "../bookings/validation";
import { queueBookingNotifications } from "../notifications/outbox.server";
import { linePaidCents, matchesOrderLine, orderSchema } from "./orders";
export async function processOrder(shopId: string, payload: unknown) {
  const order = orderSchema.parse(payload);
  if (order.financial_status !== "paid") return;
  const db = getShopDatabase(shopId);
  const unreserved = order.line_items.filter(line => line.variant_id && !line.properties.some(property => property.name === "_BookNest Reservation" && property.value));
  const linked = unreserved.length ? await db.service.findMany({ where: { active: true, priceCents: { gt: 0 },
    variantId: { in: [...new Set(unreserved.map(line => "gid://shopify/ProductVariant/" + line.variant_id))] } }, select: { variantId: true } }) : [];
  const linkedVariants = new Set(linked.map(service => service.variantId));
  const missingTimes = unreserved.filter(line => linkedVariants.has("gid://shopify/ProductVariant/" + line.variant_id));
  for (const line of order.line_items) {
    const reservationId = line.properties.find(property => property.name === "_BookNest Reservation")?.value;
    if (!reservationId) continue;
    const hold = await db.reservation.findUnique({ where: { id: reservationId } });
    if (!hold) throw new BookingError("Order references an unknown reservation.");
    await withShopTransaction(shopId, async tx => {
      const existing = await tx.booking.findFirst({ where: { OR: [{ reservationId }, { orderLineId: line.id }] } });
      if (existing) {
        if (existing.orderId !== order.id) throw new BookingError("Reservation was paid on another order. Merchant review is required.");
        return;
      }
      const current = await tx.reservation.findUniqueOrThrow({ where: { id: reservationId } });
      const location = await tx.location.findUniqueOrThrow({ where: { id: current.locationId } });
      const now = DateTime.utc();
      const start = DateTime.fromJSDate(current.startAt);
      const email = order.contact_email || order.email;
      const cancellation = await tx.webhookReceipt.findFirst({ where: { topic: "ORDERS_CANCELLED", OR: [{ payload: { path: ["id"], equals: order.id } }, ...(Number.isSafeInteger(Number(order.id)) ? [{ payload: { path: ["id"], equals: Number(order.id) } }] : [])] }, select: { id: true } });
      let available = false;
      if (!cancellation && matchesOrderLine(current, line) && email) {
        try {
          const result = await availabilityForDay(tx, shopId, current.serviceId, start.setZone(location.timezone).toISODate()!, current.quantity,
            current.staffId, undefined, current.id, now, false);
          available = result.slots.some(slot => slot.startAt.toMillis() === start.toMillis() && slot.endAt.toMillis() === current.endAt.getTime());
        } catch (error) { if (!(error instanceof BookingError) || error.status >= 500) throw error; }
      }
      const staff = await tx.staffMember.findUniqueOrThrow({ where: { id: current.staffId }, select: { contactLink: true } });
      const booking = await tx.booking.create({ data: { shopId, reservationId: current.id, serviceId: current.serviceId, staffId: current.staffId, locationId: current.locationId,
        startAt: current.startAt, endAt: current.endAt, quantity: current.quantity, orderId: order.id, orderLineId: line.id,
        customerId: order.customer?.id, customerEmail: email ?? "", customerName: [order.customer?.first_name, order.customer?.last_name].filter(Boolean).join(" ") || null,
        status: cancellation ? "CANCELLED" : available ? "CONFIRMED" : "NEEDS_REVIEW", source: "shopify", priceCents: current.priceCents, paidCents: linePaidCents(line),
        currency: current.currency, contactLink: staff.contactLink, notes: available ? null : "Paid order needs review: reservation availability, product, quantity, or contact details changed." } });
      const answers = customerInput.shape.answers.parse(current.answers);
      if (answers.length) await tx.intakeAnswer.createMany({ data: answers.map(answer => ({ ...answer, bookingId: booking.id })) });
      if (available) await queueBookingNotifications(tx, shopId, booking, "CONFIRMATION", line.id, now);
    }, [hold.staffId], [order.id]);
  }
  // Reconcile legitimate reservations first; leave a durable failed receipt for Support.
  // A paid line with no chosen time must never silently disappear or invent an appointment.
  if (missingTimes.length) throw new BookingError("Order " + order.id + " contains paid Events/Services without a booking time (line " + missingTimes.map(line => line.id).join(", ") + "). Merchant review is required.");
}
export async function processOrderCancellation(shopId: string, payload: unknown) {
  const { id } = z.object({ id: z.union([z.number().int().safe(), z.string()]).transform(String) }).parse(payload);
  // The verified receipt is already durable. It blocks future paid conversions;
  // this shared lock lets an in-flight conversion commit before we enumerate.
  const bookings = await withShopTransaction(shopId, tx => tx.booking.findMany({
    where: { orderId: id, status: { in: ["PENDING", "CONFIRMED", "NEEDS_REVIEW"] } }, select: { id: true },
  }), [], [id]);
  for (const booking of bookings) await cancelBooking(shopId, booking.id);
}
export async function processRefund(shopId: string, receiptId: string, payload: unknown) {
  const parsed = z.object({ order_id: z.union([z.number().int().safe(), z.string()]).transform(String) }).parse(payload);
  const db = getShopDatabase(shopId);
  const bookings = await db.booking.findMany({ where: { orderId: parsed.order_id }, select: { id: true, staffId: true } });
  for (const booking of bookings) await withShopTransaction(shopId, async tx => {
    const current = await tx.booking.findUniqueOrThrow({ where: { id: booking.id } });
    const marker = "[Refund " + receiptId + "]";
    if (!current.notes?.includes(marker)) await tx.booking.update({ where: { id: booking.id }, data: { notes: (current.notes ?? "") + "\n" + marker + " Review the refund in Shopify; appointment remains scheduled." } });
  }, [booking.staffId]);
}
