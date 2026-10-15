import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { computeSlots } from "./engine";
import type { ComputeSlotsInput } from "./types";
const utc = (value: string) => DateTime.fromISO(value, { zone: "utc" });
function input(overrides: Partial<ComputeSlotsInput> = {}): ComputeSlotsInput {
  return {
    service: { durationMin: 60, bufferBefore: 0, bufferAfter: 0, capacity: 1, minNoticeHours: 0, maxAdvanceDays: 90 },
    timezone: "UTC", rangeStart: utc("2026-03-02T00:00Z"), rangeEnd: utc("2026-03-09T00:00Z"),
    rules: [{ weekday: 1, startTime: "09:00", endTime: "12:00", timezone: "UTC" }],
    blackouts: [], existingBookings: [], now: utc("2026-03-01T00:00Z"), ...overrides,
  };
}
const times = (args: ComputeSlotsInput) => computeSlots(args).map(s => s.startAt.toISO());
describe("availability", () => {
  it("expands a weekly rule into UTC slots", () => {
    expect(times(input())).toEqual(["2026-03-02T09:00:00.000Z", "2026-03-02T10:00:00.000Z", "2026-03-02T11:00:00.000Z"]);
  });
  it("does not invent nonexistent spring-forward wall times", () => {
    const result = computeSlots(input({ rangeStart: utc("2026-03-08T00:00Z"), rangeEnd: utc("2026-03-09T00:00Z"),
      rules: [{ weekday: 0, startTime: "01:00", endTime: "04:00", timezone: "America/New_York" }] }));
    expect(result.map(s => s.startAt.setZone("America/New_York").toFormat("HH:mm"))).toEqual(["01:00", "03:00"]);
  });
  it("keeps both distinct instants during fall-back", () => {
    const result = computeSlots(input({ now: utc("2026-10-31T00:00Z"), rangeStart: utc("2026-11-01T00:00Z"), rangeEnd: utc("2026-11-02T00:00Z"),
      rules: [{ weekday: 0, startTime: "01:00", endTime: "03:00", timezone: "America/New_York" }] }));
    expect(result.map(s => s.startAt.toFormat("HH:mm"))).toEqual(["05:00", "06:00", "07:00"]);
  });
  it("handles southern hemisphere daylight saving", () => {
    const result = computeSlots(input({ now: utc("2026-10-02T00:00Z"), rangeStart: utc("2026-10-03T00:00Z"), rangeEnd: utc("2026-10-05T00:00Z"),
      rules: [{ weekday: 0, startTime: "01:00", endTime: "04:00", timezone: "Australia/Sydney" }] }));
    expect(result.map(s => s.startAt.setZone("Australia/Sydney").toFormat("HH:mm"))).toEqual(["01:00", "03:00"]);
  });
  it("supports a half-hour offset", () => {
    expect(times(input({ rules: [{ weekday: 1, startTime: "09:00", endTime: "10:00", timezone: "Asia/Kolkata" }] })))
      .toEqual(["2026-03-02T03:30:00.000Z"]);
  });
  it("removes a blackout inside working hours", () => {
    expect(times(input({ blackouts: [{ startAt: utc("2026-03-02T10:00Z"), endAt: utc("2026-03-02T11:00Z") }] }))).toHaveLength(2);
  });
  it("removes slots even when a blackout only overlaps their boundary", () => {
    expect(times(input({ blackouts: [{ startAt: utc("2026-03-02T09:50Z"), endAt: utc("2026-03-02T10:10Z") }] })))
      .toEqual(["2026-03-02T11:00:00.000Z"]);
  });
  it("accounts for buffers on both reservations", () => {
    const args = input(); args.service.bufferAfter = 15;
    args.existingBookings = [{ startAt: utc("2026-03-02T08:30Z"), endAt: utc("2026-03-02T09:30Z"), status: "CONFIRMED" }];
    expect(times(args)).toEqual(["2026-03-02T10:00:00.000Z"]);
  });
  it("enforces the minimum notice", () => {
    const args = input({ now: utc("2026-03-02T08:00Z") }); args.service.minNoticeHours = 2;
    expect(times(args)).toHaveLength(2);
  });
  it("enforces the maximum advance window", () => {
    const args = input(); args.service.maxAdvanceDays = 1;
    expect(times(args)).toEqual([]);
  });
  it("reports remaining group capacity including quantities", () => {
    const args = input(); args.service.capacity = 4;
    args.existingBookings = [{ startAt: utc("2026-03-02T09:00Z"), endAt: utc("2026-03-02T10:00Z"), status: "CONFIRMED", quantity: 3 }];
    expect(computeSlots(args)[0]?.remaining).toBe(1);
  });
  it("permits back-to-back appointments with zero buffer", () => {
    expect(times(input({ existingBookings: [{ startAt: utc("2026-03-02T08:00Z"), endAt: utc("2026-03-02T09:00Z"), status: "CONFIRMED" }] }))).toHaveLength(3);
  });
  it("expands an overnight rule from the preceding day", () => {
    expect(times(input({ rangeStart: utc("2026-03-03T00:00Z"), rangeEnd: utc("2026-03-03T03:00Z"),
      rules: [{ weekday: 1, startTime: "23:00", endTime: "02:00", timezone: "UTC" }] })))
      .toEqual(["2026-03-03T00:00:00.000Z", "2026-03-03T01:00:00.000Z"]);
  });
  it("keeps overnight appointments on the day they start", () => {
    const args = input({ rangeStart: utc("2026-03-02T00:00Z"), rangeEnd: utc("2026-03-03T00:00Z"),
      rules: [{ weekday: 1, startTime: "23:30", endTime: "01:30", timezone: "UTC" }] });
    expect(computeSlots(args).map(slot => [slot.startAt.toISO(), slot.endAt.toISO()]))
      .toEqual([["2026-03-02T23:30:00.000Z", "2026-03-03T00:30:00.000Z"]]);
    expect(times({ ...args, rangeStart: utc("2026-03-03T00:00Z"), rangeEnd: utc("2026-03-04T00:00Z") }))
      .toEqual(["2026-03-03T00:30:00.000Z"]);
  });
  it("blocks staff time off without affecting another Availability", () => {
    const args = input({ staffIds: ["a", "b"], blackouts: [{ startAt: utc("2026-03-02T09:00Z"), endAt: utc("2026-03-02T12:00Z"), staffId: "a" }] });
    expect(computeSlots(args).map(s => s.staffId)).toEqual(["b", "b", "b"]);
  });
  it("deduplicates overlapping rules", () => {
    const args = input(); args.rules.push(args.rules[0]!);
    expect(times(args)).toHaveLength(3);
  });
  it("requires enough remaining seats for the requested party", () => {
    const args = input({ quantity: 2 }); args.service.capacity = 3;
    args.existingBookings = [{ startAt: utc("2026-03-02T09:00Z"), endAt: utc("2026-03-02T10:00Z"), status: "PENDING", quantity: 2 }];
    expect(times(args)).not.toContain("2026-03-02T09:00:00.000Z");
  });
  it("ignores expired temporary reservations", () => {
    expect(times(input({ existingBookings: [{ startAt: utc("2026-03-02T09:00Z"), endAt: utc("2026-03-02T10:00Z"),
      status: "PENDING", expiresAt: utc("2026-02-28T00:00Z") }] }))).toHaveLength(3);
  });
  it("does not share group capacity between different services", () => {
    const args = input(); args.service.capacity = 4; args.service.id = "yoga";
    args.existingBookings = [{ serviceId: "massage", startAt: utc("2026-03-02T09:00Z"), endAt: utc("2026-03-02T10:00Z"), status: "CONFIRMED" }];
    expect(times(args)).not.toContain("2026-03-02T09:00:00.000Z");
  });
  it("intersects service opening hours with staff working hours", () => {
    const args = input({ serviceRules: [{ weekday: 1, startTime: "10:00", endTime: "11:00", timezone: "UTC" }] });
    expect(times(args)).toEqual(["2026-03-02T10:00:00.000Z"]);
  });
  it("rejects invalid zones, zero duration, and unbounded ranges", () => {
    expect(() => computeSlots(input({ timezone: "invalid" }))).toThrow();
    const args = input(); args.service.durationMin = 0;
    expect(() => computeSlots(args)).toThrow();
    expect(() => computeSlots(input({ rangeEnd: utc("2027-01-01") }))).toThrow();
  });
});

describe("independent slot interval", () => {
  it("offers shorter start intervals while preserving appointment duration", () => {
    const args = input(); args.service.slotIntervalMin = 15;
    const slots = computeSlots(args);
    expect(slots.map(slot => slot.startAt.toFormat("HH:mm"))).toEqual(["09:00", "09:15", "09:30", "09:45", "10:00", "10:15", "10:30", "10:45", "11:00"]);
    expect(slots.every(slot => slot.endAt.diff(slot.startAt, "minutes").minutes === 60)).toBe(true);
  });
  it("supports start intervals longer than the appointment duration", () => {
    const args = input(); args.service.slotIntervalMin = 90;
    expect(times(args)).toEqual(["2026-03-02T09:00:00.000Z", "2026-03-02T10:30:00.000Z"]);
  });
  it("keeps duration-based spacing for an unset interval", () => {
    const args = input(); args.service.slotIntervalMin = null;
    expect(times(args)).toEqual(times(input()));
  });
  it("retains both offsets at each wall-clock interval during fall-back", () => {
    const args = input({ now: utc("2026-10-31T00:00Z"), rangeStart: utc("2026-11-01T00:00Z"), rangeEnd: utc("2026-11-02T00:00Z"),
      rules: [{ weekday: 0, startTime: "01:00", endTime: "03:00", timezone: "America/New_York" }] });
    args.service.slotIntervalMin = 30;
    expect(times(args)).toEqual(["2026-11-01T05:00:00.000Z", "2026-11-01T05:30:00.000Z", "2026-11-01T06:00:00.000Z", "2026-11-01T06:30:00.000Z", "2026-11-01T07:00:00.000Z"]);
  });
  it("blocks overlapping alternate starts once an appointment is booked", () => {
    const args = input(); args.service.slotIntervalMin = 30; args.service.id = "yoga"; args.service.capacity = 3;
    args.existingBookings = [{ serviceId: "yoga", startAt: utc("2026-03-02T09:30Z"), endAt: utc("2026-03-02T10:30Z"), status: "CONFIRMED", quantity: 1 }];
    expect(times(args)).toEqual(["2026-03-02T09:30:00.000Z", "2026-03-02T10:30:00.000Z", "2026-03-02T11:00:00.000Z"]);
  });
  it("rejects invalid or excessive interval values", () => {
    for (const interval of [0, -1, 0.5, 1441, Infinity]) {
      const args = input(); args.service.slotIntervalMin = interval;
      expect(() => computeSlots(args)).toThrow(/interval/i);
    }
  });
});

describe("additional opening hours", () => {
  const extra = (start: string, end: string, staffId?: string, timezone = "UTC") => ({
    startAt: utc(start), endAt: utc(end), staffId, timezone,
  });
  it("opens a single date while preserving weekly hours", () => {
    const args = input({ additionalHours: [extra("2026-03-03T13:00Z", "2026-03-03T15:00Z")] });
    expect(times(args)).toEqual(["2026-03-02T09:00:00.000Z", "2026-03-02T10:00:00.000Z", "2026-03-02T11:00:00.000Z", "2026-03-03T13:00:00.000Z", "2026-03-03T14:00:00.000Z"]);
  });
  it("does not repeat date-specific hours the following week", () => {
    const args = input({ rules: [], rangeEnd: utc("2026-03-11T00:00Z"), additionalHours: [extra("2026-03-03T13:00Z", "2026-03-03T15:00Z")] });
    expect(times(args)).toEqual(["2026-03-03T13:00:00.000Z", "2026-03-03T14:00:00.000Z"]);
  });
  it("restricts individual hours to their assigned Availability", () => {
    const args = input({ rules: [], staffIds: ["a", "b"], additionalHours: [extra("2026-03-03T09:00Z", "2026-03-03T10:00Z", "a")] });
    expect(computeSlots(args).map(slot => slot.staffId)).toEqual(["a"]);
    expect(computeSlots({ ...args, staffIds: ["b"] })).toEqual([]);
  });
  it("opens broad hours for each provided Availability", () => {
    const args = input({ rules: [], staffIds: ["a", "b"], additionalHours: [extra("2026-03-03T09:00Z", "2026-03-03T10:00Z")] });
    expect(computeSlots(args).map(slot => slot.staffId)).toEqual(["a", "b"]);
  });
  it("keeps closures and existing appointments authoritative", () => {
    const args = input({ rules: [], additionalHours: [extra("2026-03-03T09:00Z", "2026-03-03T12:00Z")],
      blackouts: [extra("2026-03-03T09:00Z", "2026-03-03T10:00Z")],
      existingBookings: [{ ...extra("2026-03-03T10:00Z", "2026-03-03T11:00Z"), status: "CONFIRMED", serviceId: "another" }] });
    expect(times(args)).toEqual(["2026-03-03T11:00:00.000Z"]);
  });
  it("still intersects the Event/Service booking hours", () => {
    const args = input({ additionalHours: [extra("2026-03-03T13:00Z", "2026-03-03T15:00Z")],
      serviceRules: [{ weekday: 1, startTime: "10:00", endTime: "11:00", timezone: "UTC" }] });
    expect(times(args)).toEqual(["2026-03-02T10:00:00.000Z"]);
  });
  it("combines touching weekly and additional hours for a longer appointment", () => {
    const args = input({ rules: [{ weekday: 1, startTime: "09:00", endTime: "10:00", timezone: "UTC" }],
      additionalHours: [extra("2026-03-02T10:00Z", "2026-03-02T11:00Z")] });
    args.service.durationMin = 90;
    expect(times(args)).toEqual(["2026-03-02T09:00:00.000Z"]);
  });
  it("deduplicates additional hours overlapping a weekly rule", () => {
    expect(times(input({ additionalHours: [extra("2026-03-02T10:00Z", "2026-03-02T13:00Z")] })))
      .toEqual(["2026-03-02T09:00:00.000Z", "2026-03-02T10:00:00.000Z", "2026-03-02T11:00:00.000Z", "2026-03-02T12:00:00.000Z"]);
  });
  it("keeps both fall-back offsets and skips spring-forward gaps", () => {
    const fall = input({ rules: [], now: utc("2026-10-31T00:00Z"), rangeStart: utc("2026-11-01T00:00Z"), rangeEnd: utc("2026-11-02T00:00Z"),
      additionalHours: [extra("2026-11-01T04:00Z", "2026-11-01T08:00Z", undefined, "America/New_York")] });
    expect(times(fall)).toEqual(["2026-11-01T04:00:00.000Z", "2026-11-01T05:00:00.000Z", "2026-11-01T06:00:00.000Z", "2026-11-01T07:00:00.000Z"]);
    const spring = input({ rules: [], rangeStart: utc("2026-03-08T00:00Z"), rangeEnd: utc("2026-03-09T00:00Z"),
      additionalHours: [extra("2026-03-08T05:00Z", "2026-03-08T08:00Z", undefined, "America/New_York")] });
    expect(times(spring)).toEqual(["2026-03-08T05:00:00.000Z", "2026-03-08T06:00:00.000Z", "2026-03-08T07:00:00.000Z"]);
  });
  it("includes overnight appointments on the date they start", () => {
    const args = input({ rules: [], rangeEnd: utc("2026-03-03T00:00Z"), additionalHours: [extra("2026-03-02T23:30Z", "2026-03-03T01:30Z")] });
    expect(times(args)).toEqual(["2026-03-02T23:30:00.000Z"]);
  });
  it("rejects invalid zones and excessively long additional openings", () => {
    expect(() => computeSlots(input({ additionalHours: [extra("2026-03-02T09:00Z", "2026-03-02T12:00Z", undefined, "invalid")] }))).toThrow();
    expect(() => computeSlots(input({ additionalHours: [extra("2026-03-02T09:00Z", "2026-03-05T12:00Z")] }))).toThrow();
  });
});
