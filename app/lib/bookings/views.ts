import { DateTime } from "luxon";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { timezoneSchema } from "../admin/schemas";
export const bookingTabs = ["upcoming", "recent", "cancelled", "all"] as const;
export const bookingViews = ["list", "agenda", "calendar", "availability"] as const;
export function bookingFilters(params: URLSearchParams, defaultZone: string, now: DateTime = DateTime.utc()) {
  const tab = z.enum(bookingTabs).catch("upcoming").parse(params.get("tab"));
  const view = z.enum(bookingViews).catch("list").parse(params.get("view"));
  const page = z.coerce.number().int().min(1).max(10000).catch(1).parse(params.get("page") ?? 1);
  const timezone = timezoneSchema.catch(defaultZone).parse(params.get("timezone") || defaultZone);
  const requestedDay = params.get("day") ?? "";
  const parsed = DateTime.fromISO(requestedDay, { zone: timezone });
  const day = /^\d{4}-\d{2}-\d{2}$/.test(requestedDay) && parsed.isValid ? requestedDay : now.setZone(timezone).toISODate()!;
  const anchor = DateTime.fromISO(day, { zone: timezone });
  const start = view === "calendar" ? anchor.startOf("month") : anchor.startOf("day");
  const end = view === "calendar" ? start.plus({ months: 1 }) : start.plus({ days: view === "agenda" ? 7 : 1 });
  const q = (params.get("q") ?? "").trim().slice(0, 200);
  const staff = (params.get("staff") ?? "").slice(0, 100);
  const service = (params.get("service") ?? "").slice(0, 100);
  const hideChecked = params.get("hideChecked") === "1";
  const where: Prisma.BookingWhereInput = {
    ...(tab === "upcoming" ? { status: { in: ["PENDING", "CONFIRMED", "NEEDS_REVIEW"] }, startAt: { gte: now.toJSDate() } }
      : tab === "cancelled" ? { status: "CANCELLED" } : {}),
    ...(view !== "list" ? { startAt: { gte: (tab === "upcoming" && now > start ? now : start).toJSDate(), lt: end.toJSDate() } } : {}),
    ...(hideChecked ? { checkedInAt: null } : {}),
    ...(staff ? { staffId: staff } : {}), ...(service ? { serviceId: service } : {}),
    ...(q ? { OR: [{ customerEmail: { contains: q, mode: "insensitive" } }, { customerName: { contains: q, mode: "insensitive" } }, { orderId: { contains: q } }, { id: { equals: q } }] } : {}),
  };
  return { tab, view, page, timezone, day, q, staff, service, hideChecked, where, limit: view === "list" ? 25 : 500,
    orderBy: (tab === "recent" && view === "list" ? { createdAt: "desc" } : { startAt: "asc" }) as Prisma.BookingOrderByWithRelationInput };
}
export function calendarDays(day: string, timezone: string) {
  const month = DateTime.fromISO(day, { zone: timezone }).startOf("month");
  const first = month.startOf("week");
  return Array.from({ length: 42 }, (_, i) => {
    const value = first.plus({ days: i });
    return { date: value.toISODate()!, label: value.toFormat("ccc d LLL"), day: value.day, inMonth: value.month === month.month };
  });
}
export const bookingSelect = {
  id: true, staffId: true, startAt: true, endAt: true, quantity: true, status: true, checkedInAt: true,
  customerName: true, customerEmail: true, source: true, orderId: true,
  service: { select: { title: true } }, staff: { select: { firstName: true, lastName: true } }, location: { select: { name: true } },
} satisfies Prisma.BookingSelect;
export type BookingRow = Prisma.BookingGetPayload<{ select: typeof bookingSelect }>;
export function csvCell(value: unknown) {
  let text = value == null ? "" : String(value);
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
export function serializeBookings(rows: BookingRow[], timezone: string) {
  const headers = ["Booking ID", "Start", "End", "Timezone", "Event/Service", "Availability", "Location", "Guests", "Status", "Customer", "Email", "Order ID", "Source", "Checked in"];
  const format = (value: Date) => DateTime.fromJSDate(value).setZone(timezone).toISO();
  return "\uFEFF" + [headers, ...rows.map(b => [b.id, format(b.startAt), format(b.endAt), timezone, b.service.title,
    b.staff.firstName + " " + b.staff.lastName, b.location.name, b.quantity, b.status, b.customerName, b.customerEmail,
    b.orderId, b.source, b.checkedInAt ? format(b.checkedInAt) : ""])].map(row => row.map(csvCell).join(",")).join("\r\n");
}
