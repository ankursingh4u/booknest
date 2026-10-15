import { expect, it } from "vitest";
import { calendarIntervals } from "./events";
it("converts all-day events using the calendar timezone across DST", () => {
  const intervals = calendarIntervals({ timeZone: "America/New_York", items: [{ id: "event", start: { date: "2026-03-08" }, end: { date: "2026-03-09" } }] }, [], "staff");
  expect(intervals[0]?.startAt.toISO()).toBe("2026-03-08T05:00:00.000Z");
  expect(intervals[0]?.endAt.toISO()).toBe("2026-03-09T04:00:00.000Z");
});
it("does not double-count a matching BookNest event as external busy time", () => {
  const event = { id: "event", start: { dateTime: "2026-10-20T09:00Z" }, end: { dateTime: "2026-10-20T10:00Z" }, extendedProperties: { private: { booknestBooking: "booking" } } };
  expect(calendarIntervals({ timeZone: "UTC", items: [event] }, [{ id: "booking", startAt: new Date("2026-10-20T09:00Z"), endAt: new Date("2026-10-20T10:00Z") }], "staff")).toEqual([]);
  expect(calendarIntervals({ timeZone: "UTC", items: [event] }, [], "staff")).toHaveLength(1);
});
it("ignores transparent and cancelled events", () => {
  expect(calendarIntervals({ timeZone: "UTC", items: [
    { id: "transparent", transparency: "transparent" }, { id: "cancelled", status: "cancelled" },
  ] }, [], "staff")).toEqual([]);
});
