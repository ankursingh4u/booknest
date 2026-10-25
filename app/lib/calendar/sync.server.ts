import { createHash } from "node:crypto";
import { DateTime } from "luxon";
import { getShopDatabase, withShopTransaction } from "../../db.server";
import { calendarRequest } from "./client.server";
export async function syncBookingCalendar(shopId: string, taskId: string) {
  const db = getShopDatabase(shopId);
  const task = await db.notificationTask.findUnique({ where: { id: taskId } });
  if (!task || task.completedAt || task.attempts >= 5) return;
  const initial = await db.booking.findUniqueOrThrow({ where: { id: task.bookingId } });
  await withShopTransaction(shopId, async tx => {
    const booking = await tx.booking.findUniqueOrThrow({ where: { id: initial.id }, include: { service: { select: { title: true } }, location: { select: { name: true } } } });
    if (booking.staffId !== initial.staffId) throw new Error("Booking changed while calendar sync was queued");
    if (booking.startAt.getTime() !== task.expectedStartAt.getTime()) {
      await tx.notificationTask.update({ where: { id: taskId }, data: { completedAt: DateTime.utc().toJSDate() } }); return;
    }
    const shop = await tx.shop.findUniqueOrThrow({ where: { id: shopId }, select: { googleCalendarId: true } });
    if (booking.googleEventId && booking.googleEventCalendarId
      && (booking.status === "CANCELLED" || !shop.googleCalendarId || booking.googleEventCalendarId !== shop.googleCalendarId)) {
      const response = await calendarRequest(shopId, "calendars/" + encodeURIComponent(booking.googleEventCalendarId) + "/events/" + encodeURIComponent(booking.googleEventId) + "?sendUpdates=none", { method: "DELETE" });
      if (!response.ok && response.status !== 404 && response.status !== 410) throw new Error("Calendar event could not be removed");
      await tx.booking.update({ where: { id: booking.id }, data: { googleEventId: null, googleEventCalendarId: null } });
    }
    if (["CONFIRMED", "COMPLETED", "NO_SHOW"].includes(booking.status) && shop.googleCalendarId) {
      const id = "bn" + createHash("sha256").update(shopId + ":" + booking.id).digest("hex");
      const event = { id, status: "confirmed", summary: booking.service.title + " · " + (booking.customerName || "Customer"), location: booking.location.name,
        description: "BookNest booking " + booking.id + (booking.contactLink ? "\n" + booking.contactLink : ""),
        start: { dateTime: booking.startAt.toISOString(), timeZone: "UTC" }, end: { dateTime: booking.endAt.toISOString(), timeZone: "UTC" },
        extendedProperties: { private: { booknestShop: shopId, booknestBooking: booking.id } } };
      const basePath = "calendars/" + encodeURIComponent(shop.googleCalendarId) + "/events";
      let response = await calendarRequest(shopId, basePath + "?sendUpdates=none", { method: "POST", body: JSON.stringify(event) });
      if (response.status === 409) response = await calendarRequest(shopId, basePath + "/" + id + "?sendUpdates=none", { method: "PUT", body: JSON.stringify(event) });
      if (!response.ok) throw new Error("Calendar event could not be saved");
      await tx.booking.update({ where: { id: booking.id }, data: { googleEventId: id, googleEventCalendarId: shop.googleCalendarId } });
      await tx.shop.update({ where: { id: shopId }, data: { googleSyncError: null } });
    }
    await tx.notificationTask.update({ where: { id: taskId }, data: { completedAt: DateTime.utc().toJSDate(), lastError: null } });
  }, [initial.staffId]);
}
