import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { bookingFilters, calendarDays, csvCell, serializeBookings } from "./views";
describe("booking views", () => {
  const now = DateTime.fromISO("2026-03-08T12:00:00Z");
  it("bounds calendar months in the selected timezone across DST", () => {
    const f = bookingFilters(new URLSearchParams("view=calendar&day=2026-03-08&tab=all&timezone=America/New_York"), "UTC", now);
    expect(f.where.startAt).toEqual({ gte: new Date("2026-03-01T05:00:00Z"), lt: new Date("2026-04-01T04:00:00Z") });
    expect(f.limit).toBe(500);
  });
  it("intersects upcoming status with the view window and validates timezone", () => {
    const f = bookingFilters(new URLSearchParams("view=agenda&day=2026-03-08&timezone=bad&staff=s1&service=e1&hideChecked=1"), "UTC", now);
    expect(f.timezone).toBe("UTC");
    expect(f.where).toMatchObject({ staffId: "s1", serviceId: "e1", checkedInAt: null, startAt: { gte: now.toJSDate() } });
    expect(f.where.status).toEqual({ in: ["PENDING", "CONFIRMED", "NEEDS_REVIEW"] });
  });
  it("does not silently accept impossible dates or unbounded pagination", () => {
    const f = bookingFilters(new URLSearchParams("day=2026-02-30&page=-2&view=bad"), "UTC", now);
    expect(f.day).toBe("2026-03-08"); expect(f.page).toBe(1); expect(f.view).toBe("list");
  });
  it("builds an accessible month grid with explicit padding days", () => {
    const days = calendarDays("2026-03-08", "America/New_York");
    expect(days).toHaveLength(42); expect(days[0]!.date).toBe("2026-02-23");
    expect(days.filter(d => d.inMonth)).toHaveLength(31);
  });
  it("quotes CSV and neutralizes formula prefixes including leading whitespace", () => {
    expect(csvCell('hello,"there"')).toBe('"hello,""there"""');
    expect(csvCell(" \t=SUM(A1)")).toBe('"\' \t=SUM(A1)"');
    expect(csvCell("+123")).toBe('"\'+123"');
  });
  it("exports viewer-local timestamps and excludes customer portal credentials", () => {
    const csv = serializeBookings([{ id: "b1", staffId: "s1", startAt: new Date("2026-03-08T12:00:00Z"), endAt: new Date("2026-03-08T13:00:00Z"), quantity: 1, status: "CONFIRMED", customerName: "=1+1", customerEmail: "a@example.com", source: "widget", orderId: null, checkedInAt: null, service: { title: "Consult" }, staff: { firstName: "A", lastName: "B" }, location: { name: "Main" } }], "Asia/Kolkata");
    expect(csv).toContain("2026-03-08T17:30:00.000+05:30");
    expect(csv).toContain("\'=1+1"); expect(csv).not.toContain("cancelToken");
  });
});
