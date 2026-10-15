import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DateTime } from "luxon";
const state = vi.hoisted(() => ({ db: {} as Record<string, any> }));
vi.mock("../../db.server", () => ({ getShopDatabase: () => state.db, withShopTransaction: (_shop: string, work: (db: unknown) => unknown) => work(state.db) }));
import { listDaySlots, listMonthAvailability } from "./service.server";
const now = DateTime.utc(2026, 10, 1);
beforeEach(() => {
  state.db = {
    service: { findFirst: vi.fn().mockResolvedValue({ id: "service", active: true, locationId: "location", durationMin: 60, capacity: 2, bufferBefore: 0, bufferAfter: 0, minNoticeHours: 0, maxAdvanceDays: 60 }) },
    location: { findFirst: vi.fn().mockResolvedValue({ id: "location", timezone: "Asia/Kolkata", active: true }) },
    serviceStaff: { findMany: vi.fn().mockResolvedValue([{ staffId: "staff" }]) },
    staffMember: { findMany: vi.fn().mockResolvedValue([{ id: "staff", firstName: "A", lastName: "B" }]) },
    availabilityRule: { findMany: vi.fn().mockResolvedValue([{ staffId: "staff", serviceId: null, weekday: 1, startTime: "09:00", endTime: "11:00", timezone: "Asia/Kolkata" }]) },
    additionalHours: { findMany: vi.fn().mockResolvedValue([]) },
    blackout: { findMany: vi.fn().mockResolvedValue([]) }, timeOffRequest: { findMany: vi.fn().mockResolvedValue([]) },
    booking: { findMany: vi.fn().mockResolvedValue([]) }, reservation: { findMany: vi.fn().mockResolvedValue([]) },
    shop: { findUniqueOrThrow: vi.fn().mockResolvedValue({ currency: "USD", domain: "shop.myshopify.com" }) },
  };
});
afterEach(() => vi.restoreAllMocks());
describe("viewer calendar availability", () => {
  it("queries the viewer's day when the appointment falls on another service-local date", async () => {
    const result = await listDaySlots("shop", "service", "2026-10-18", 1, undefined, undefined, "America/Los_Angeles", now);
    expect(result.timezone).toBe("America/Los_Angeles");
    expect(result.capacity).toBe(2);
    expect(result.slots.map(slot => slot.startAt)).toEqual(["2026-10-19T03:30:00.000Z", "2026-10-19T04:30:00.000Z"]);
    expect(result.slots[0]!.label).toContain("8:30");
    expect(state.db.booking.findMany.mock.calls[0][0].where.endAt.gt.toISOString()).toBe("2026-10-16T07:00:00.000Z");
  });
  it("returns every viewer-local day and disables days without slots using one scheduling query", async () => {
    const result = await listMonthAvailability("shop", "service", "2026-10", 1, "America/Los_Angeles", now);
    expect(result.days).toHaveLength(31);
    expect(result.days.find(day => day.date === "2026-10-18")?.available).toBe(true);
    expect(result.days.find(day => day.date === "2026-10-19")?.available).toBe(false);
    expect(state.db.availabilityRule.findMany).toHaveBeenCalledOnce();
    expect(state.db.booking.findMany).toHaveBeenCalledOnce();
    expect(result.today).toBe("2026-09-30");
  });
  it("rejects invalid or impossible months and unknown timezones", async () => {
    await expect(listMonthAvailability("shop", "service", "2026-13", 1, "UTC", now)).rejects.toThrow("month");
    await expect(listMonthAvailability("shop", "service", "bad", 1, "UTC", now)).rejects.toThrow("month");
    await expect(listDaySlots("shop", "service", "2026-10-18", 1, undefined, undefined, "invalid", now)).rejects.toThrow("timezone");
  });
});

it("includes date-specific extra hours in both slots and viewer-month availability", async () => {
  state.db.availabilityRule.findMany.mockResolvedValue([]);
  state.db.additionalHours.findMany.mockResolvedValue([{ locationId: "location", staffId: null, timezone: "Asia/Kolkata", startAt: new Date("2026-10-20T03:30Z"), endAt: new Date("2026-10-20T05:30Z") }]);
  const slots = await listDaySlots("shop", "service", "2026-10-19", 1, undefined, undefined, "America/Los_Angeles", now);
  expect(slots.slots.map(slot => slot.startAt)).toEqual(["2026-10-20T03:30:00.000Z", "2026-10-20T04:30:00.000Z"]);
  const month = await listMonthAvailability("shop", "service", "2026-10", 1, "America/Los_Angeles", now);
  expect(month.days.find(day => day.date === "2026-10-19")?.available).toBe(true);
  expect(state.db.additionalHours.findMany.mock.calls[0][0].where).toEqual(expect.objectContaining({ locationId: "location", OR: [{ staffId: null }, { staffId: { in: ["staff"] } }] }));
});
