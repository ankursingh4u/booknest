import { Resend } from "resend";
import { DateTime } from "luxon";
import { getShopDatabase } from "../../db.server";
const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
export async function sendNotification(shopId: string, taskId: string) {
  const db = getShopDatabase(shopId);
  const task = await db.notificationTask.findUnique({ where: { id: taskId } });
  if (!task || task.completedAt || task.attempts >= 5) return;
  const [booking, shop] = await Promise.all([
    db.booking.findUniqueOrThrow({ where: { id: task.bookingId }, include: { service: { select: { title: true } }, location: { select: { name: true, timezone: true } }, staff: { select: { firstName: true, lastName: true } } } }),
    db.shop.findUniqueOrThrow({ where: { id: shopId }, select: { domain: true, email: true, uninstalledAt: true } }),
  ]);
  const expectedStatus = task.kind === "CANCELLED" ? "CANCELLED" : "CONFIRMED";
  if (shop.uninstalledAt || task.kind.startsWith("REMINDER") && booking.startAt <= DateTime.utc().toJSDate() || booking.status !== expectedStatus || booking.startAt.getTime() !== task.expectedStartAt.getTime()) {
    await db.notificationTask.update({ where: { id: task.id }, data: { completedAt: DateTime.utc().toJSDate() } }); return;
  }
  const template = await db.notificationTemplate.findFirst({ where: { type: task.kind, channel: "email" } });
  if (template && !template.enabled) { await db.notificationTask.update({ where: { id: task.id }, data: { completedAt: DateTime.utc().toJSDate() } }); return; }
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM || !process.env.SHOPIFY_APP_URL) throw new Error("Notification configuration is incomplete");
  const start = DateTime.fromJSDate(booking.startAt).setZone(booking.location.timezone).toFormat("cccc, dd LLL yyyy 'at' h:mm a ZZZZ");
  const link = new URL("/booking/" + booking.cancelToken, process.env.SHOPIFY_APP_URL).href;
  const title = task.kind === "CANCELLED" ? "Booking cancelled" : task.kind === "RESCHEDULED" ? "Booking rescheduled" : task.kind.startsWith("REMINDER") ? "Appointment reminder" : "Booking confirmed";
  const values: Record<string, string> = { customer_name: booking.customerName ?? "there", service_name: booking.service.title, start_time: start,
    location: booking.location.name, staff_name: booking.staff.firstName + " " + booking.staff.lastName, manage_url: link, contact_link: booking.contactLink ?? "" };
  const render = (text: string) => text.replace(/{{\s*(\w+)\s*}}/g, (_match, key: string) => values[key] ?? "");
  const subject = render(template?.subject || title + " · {{service_name}}").replace(/[\r\n]/g, " ").slice(0, 200);
  const text = render(template?.body || "Hi {{customer_name}},\n\n" + title + ": {{service_name}}\n{{start_time}}\n{{location}}\nAvailability: {{staff_name}}\n\nManage your booking: {{manage_url}}\n{{contact_link}}");
  const result = await new Resend(process.env.RESEND_API_KEY).emails.send({
    from: process.env.EMAIL_FROM, to: booking.customerEmail, ...(shop.email ? { replyTo: shop.email } : {}), subject, text,
    html: "<div style=\"font-family:Arial,sans-serif;line-height:1.6\">" + escape(text).replaceAll("\n", "<br>") + "</div>",
  }, { idempotencyKey: task.dedupeKey });
  if (result.error) throw new Error("Email provider rejected the message");
  await db.notificationTask.update({ where: { id: task.id }, data: { completedAt: DateTime.utc().toJSDate(), lastError: null } });
}
