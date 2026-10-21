import { DateTime } from "luxon";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  auth: vi.fn(), transaction: vi.fn(),
  db: {
    additionalHours: { create: vi.fn(), delete: vi.fn(), findUnique: vi.fn(), count: vi.fn() },
    location: { findFirst: vi.fn() }, staffMember: { findMany: vi.fn() }, reservation: { count: vi.fn() },
    availabilityRule: { create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  },
}));
vi.mock("../lib/auth/admin.server", () => ({ requireShop: mocks.auth }));
vi.mock("../db.server", () => ({ withShopTransaction: mocks.transaction }));
vi.mock("../lib/admin/catalog.server", () => ({ catalogData: vi.fn(), CatalogError: class extends Error {} }));
vi.mock("../lib/team/time-off.server", () => ({ decideTimeOff: vi.fn(), revokeTimeOff: vi.fn() }));
import { action } from "./app.schedules";
function args(values: Record<string, string>, search = "") {
  const request = new Request("https://booknest.example/app/schedules" + search, { method: "POST", body: new URLSearchParams(values) });
  return { request, url: new URL(request.url), pattern: "/app/schedules", params: {}, context: {} };
}
const values = { intent: "additional.save", locationId: "loc", staffId: "a", date: "2026-03-02", startTime: "09:00", endTime: "12:00", timezone: "UTC", note: "" };
const record = { id: "hours", shopId: "shop", locationId: "loc", staffId: null, startAt: DateTime.fromISO("2026-03-02T09:00Z").toJSDate(), endAt: DateTime.fromISO("2026-03-02T12:00Z").toJSDate() };
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(DateTime.fromISO("2026-03-01T00:00Z").toMillis());
  mocks.auth.mockResolvedValue({ shop: { id: "shop" }, db: mocks.db });
  mocks.transaction.mockImplementation(async (_shop: string, work: (db: typeof mocks.db) => Promise<unknown>) => work(mocks.db));
  mocks.db.location.findFirst.mockResolvedValue({ id: "loc", active: true });
  mocks.db.staffMember.findMany.mockResolvedValue([{ id: "a" }, { id: "b" }]);
  mocks.db.additionalHours.count.mockResolvedValue(0); mocks.db.reservation.count.mockResolvedValue(0);
  mocks.db.additionalHours.findUnique.mockResolvedValue(record);
});
afterEach(() => vi.useRealTimers());
describe("additional schedule hours", () => {
  it("saves individual hours after checking location assignment and locking the Availability", async () => {
    const result = await action(args(values));
    expect(result).toBeInstanceOf(Response);
    expect(mocks.db.additionalHours.create).toHaveBeenCalledWith({ data: expect.objectContaining({ shopId: "shop", locationId: "loc", staffId: "a" }) });
    expect(mocks.db.staffMember.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ active: true, locationIds: { has: "loc" } }) }));
    expect(mocks.transaction).toHaveBeenCalledWith("shop", expect.any(Function), ["a"]);
  });
  it("rejects an Availability not assigned to the chosen location", async () => {
    mocks.db.staffMember.findMany.mockResolvedValue([{ id: "b" }]);
    const result = await action(args(values));
    expect(result).toMatchObject({ data: { error: expect.stringMatching(/assigned to this location/) } });
    expect(mocks.db.additionalHours.create).not.toHaveBeenCalled();
  });
  it("rejects missing or inactive locations", async () => {
    mocks.db.location.findFirst.mockResolvedValue(null);
    const result = await action(args(values));
    expect(result).toMatchObject({ data: { error: expect.stringMatching(/active location/) } });
    expect(mocks.db.additionalHours.create).not.toHaveBeenCalled();
  });
  it("locks every location Availability when removing broad hours", async () => {
    await action(args({ intent: "additional.delete", id: "hours" }));
    expect(mocks.transaction).toHaveBeenCalledWith("shop", expect.any(Function), ["a", "b"]);
    expect(mocks.db.additionalHours.delete).toHaveBeenCalledWith({ where: { id: "hours" } });
  });
  it("does not remove hours with an active checkout hold", async () => {
    mocks.db.reservation.count.mockResolvedValue(1);
    const result = await action(args({ intent: "additional.delete", id: "hours" }));
    expect(result).toMatchObject({ data: { error: expect.stringMatching(/checkout/) } });
    expect(mocks.db.additionalHours.delete).not.toHaveBeenCalled();
  });
  it("rejects unknown additional hours without deleting another record", async () => {
    mocks.db.additionalHours.findUnique.mockResolvedValue(null);
    await expect(action(args({ intent: "additional.delete", id: "foreign-hours" }))).rejects.toMatchObject({ status: 404 });
    expect(mocks.db.additionalHours.delete).not.toHaveBeenCalled();
  });
});

describe("weekly hours", () => {
  it("saves a new rule for a single weekday", async () => {
    await action(args({ intent: "rule.save", staffId: "a", weekday: "1", startTime: "09:00", endTime: "17:00", timezone: "UTC" }));
    expect(mocks.db.availabilityRule.create).toHaveBeenCalledWith({ data: expect.objectContaining({ shopId: "shop", staffId: "a", weekday: 1, startTime: "09:00", endTime: "17:00" }) });
  });
  it("updates only the time range of an existing rule, not its owner or weekday", async () => {
    await action(args({ intent: "rule.update", id: "rule-a", startTime: "10:00", endTime: "18:00" }));
    expect(mocks.db.availabilityRule.update).toHaveBeenCalledWith({ where: { id: "rule-a" }, data: { startTime: "10:00", endTime: "18:00" } });
  });
  it("rejects an update where start and end times are equal", async () => {
    const result = await action(args({ intent: "rule.update", id: "rule-a", startTime: "09:00", endTime: "09:00" }));
    expect(result).toMatchObject({ data: { error: expect.any(String) } });
    expect(mocks.db.availabilityRule.update).not.toHaveBeenCalled();
  });
  it("deletes a rule by id", async () => {
    await action(args({ intent: "rule.delete", id: "rule-a" }));
    expect(mocks.db.availabilityRule.delete).toHaveBeenCalledWith({ where: { id: "rule-a" } });
  });
  it("redirects back to the same owner's filtered view the request came from", async () => {
    const result = await action(args({ intent: "rule.delete", id: "rule-a" }, "?staffId=a"));
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).headers.get("location")).toBe("/app/schedules?staffId=a");
  });
});
