import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import { Resend } from "resend";
import { z } from "zod";
import { getShopDatabase, withShopTransaction } from "../../db.server";
const requestSchema = z.object({ customer: z.object({ id: z.union([z.string(), z.number().int().safe()]).transform(String), email: z.string().email().optional() }) });
export async function processCustomerRequest(shopId: string, receiptId: string, payload: unknown, redact: boolean) {
  const { customer } = requestSchema.parse(payload);
  const db = getShopDatabase(shopId);
  const where = { OR: [{ customerId: customer.id }, ...(customer.email ? [{ customerEmail: customer.email }] : [])] };
  if (redact) {
    await withShopTransaction(shopId, async tx => {
      const bookings = await tx.booking.findMany({ where, select: { id: true, reservationId: true, startAt: true, googleEventId: true } });
      const ids = bookings.map(b => b.id);
      await tx.notificationTask.deleteMany({ where: { bookingId: { in: ids } } });
      await tx.intakeAnswer.deleteMany({ where: { bookingId: { in: ids } } });
      for (const booking of bookings) await tx.booking.update({ where: { id: booking.id }, data: {
        customerId: null, customerEmail: "", customerName: null, customerPhone: null, notes: null, cancelToken: randomUUID(), rescheduleToken: randomUUID(),
      } });
      const reservationIds = bookings.flatMap(booking => booking.reservationId ? [booking.reservationId] : []);
      await tx.reservation.updateMany({ where: { id: { in: reservationIds } }, data: { answers: [], checkoutUrl: null } });
      // Privacy requests also cover failed or unprocessed webhook copies.
      await tx.webhookReceipt.updateMany({ where: { OR: [
        { payload: { path: ["customer", "id"], equals: customer.id } },
        ...(Number.isSafeInteger(Number(customer.id)) ? [{ payload: { path: ["customer", "id"], equals: Number(customer.id) } }] : []),
        ...(customer.email ? [
          { payload: { path: ["email"], equals: customer.email } },
          { payload: { path: ["contact_email"], equals: customer.email } },
          { payload: { path: ["customer", "email"], equals: customer.email } },
        ] : []),
      ] }, data: { payload: {}, processedAt: DateTime.utc().toJSDate(), lastError: null } });
      for (const booking of bookings.filter(b => b.googleEventId)) await tx.notificationTask.create({ data: {
        shopId, bookingId: booking.id, kind: "CALENDAR_SYNC", expectedStartAt: booking.startAt,
        runAt: DateTime.utc().toJSDate(), dedupeKey: "privacy-calendar:" + receiptId + ":" + booking.id,
      } });
    });
    return;
  }
  const shop = await db.shop.findUniqueOrThrow({ where: { id: shopId }, select: { email: true } });
  if (!shop.email || !process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) throw new Error("Store contact email is required for a data request");
  const bookings = await db.booking.findMany({ where, select: { id: true, startAt: true, endAt: true, customerName: true, customerEmail: true, customerPhone: true,
    status: true, notes: true, orderId: true, answers: { select: { questionId: true, value: true } } } });
  const result = await new Resend(process.env.RESEND_API_KEY).emails.send({
    from: process.env.EMAIL_FROM, to: shop.email, subject: "BookNest customer data request",
    text: "Shopify requested an export of this customer's BookNest data. The attached file contains the matching records for your store.",
    attachments: [{ filename: "booknest-customer-data.json", content: Buffer.from(JSON.stringify({ generatedAt: DateTime.utc().toISO(), bookings }, null, 2)).toString("base64") }],
  }, { idempotencyKey: "privacy:" + receiptId });
  if (result.error) throw new Error("Data request delivery failed");
}
