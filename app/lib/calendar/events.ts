import { DateTime } from "luxon";
import { z } from "zod";
const time = z.object({ date: z.string().optional(), dateTime: z.string().optional(), timeZone: z.string().optional() });
export const calendarPage = z.object({
  timeZone: z.string().default("UTC"), nextPageToken: z.string().optional(),
  items: z.array(z.object({ id: z.string(), status: z.string().optional(), transparency: z.string().optional(),
    start: time.optional(), end: time.optional(), extendedProperties: z.object({ private: z.record(z.string()).optional() }).optional(),
  })).default([]),
});
export function calendarIntervals(value: unknown, known: { id: string; startAt: Date; endAt: Date }[]) {
  const page = calendarPage.parse(value);
  return page.items.flatMap(event => {
    if (event.status === "cancelled" || event.transparency === "transparent") return [];
    if (!event.start || !event.end) throw new Error("Calendar returned an invalid event");
    const startAt = DateTime.fromISO(event.start.dateTime ?? event.start.date ?? "", { zone: event.start.timeZone ?? page.timeZone }).toUTC();
    const endAt = DateTime.fromISO(event.end.dateTime ?? event.end.date ?? "", { zone: event.end.timeZone ?? page.timeZone }).toUTC();
    if (!startAt.isValid || !endAt.isValid || endAt <= startAt) throw new Error("Calendar returned an invalid interval");
    const booking = known.find(item => item.id === event.extendedProperties?.private?.booknestBooking);
    if (booking && booking.startAt.getTime() === startAt.toMillis() && booking.endAt.getTime() === endAt.toMillis()) return [];
    return [{ startAt, endAt }];
  });
}
