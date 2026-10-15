import type { Prisma } from "@prisma/client";
import { DateTime } from "luxon";
export async function queueBookingNotifications(
  tx: Prisma.TransactionClient, shopId: string, booking: { id: string; startAt: Date }, kind: "CONFIRMATION" | "RESCHEDULED" | "CANCELLED",
  eventKey: string, now: DateTime = DateTime.utc(),
) {
  const start = DateTime.fromJSDate(booking.startAt, { zone: "utc" });
  const tasks: Prisma.NotificationTaskCreateManyInput[] = [{ shopId, bookingId: booking.id, kind, expectedStartAt: booking.startAt,
    dedupeKey: shopId + ":" + booking.id + ":" + kind + ":" + eventKey, runAt: now.toJSDate() }];
  if (kind !== "CANCELLED") {
    for (const hours of [24, 1]) {
      const runAt = start.minus({ hours });
      if (runAt > now) tasks.push({ shopId, bookingId: booking.id, kind: "REMINDER_" + hours + "H", expectedStartAt: booking.startAt,
        dedupeKey: shopId + ":" + booking.id + ":reminder:" + hours + ":" + start.toISO(), runAt: runAt.toJSDate() });
    }
  }
  tasks.push({ shopId, bookingId: booking.id, kind: "CALENDAR_SYNC", expectedStartAt: booking.startAt,
    dedupeKey: shopId + ":" + booking.id + ":calendar:" + kind + ":" + eventKey, runAt: now.toJSDate() });
  await tx.notificationTask.createMany({ data: tasks, skipDuplicates: true });
}
