import { DateTime } from "luxon";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  resolve: vi.fn(), service: vi.fn(), slots: vi.fn(), cancel: vi.fn(), reschedule: vi.fn(),
}));
vi.mock("../db.server", () => ({
  resolveCustomerBooking: mocks.resolve,
  getShopDatabase: () => ({ service: { findUniqueOrThrow: mocks.service } }),
}));
vi.mock("../lib/bookings/service.server", () => ({
  listDaySlots: mocks.slots, cancelBooking: mocks.cancel, rescheduleBooking: mocks.reschedule,
}));
import { action, loader } from "./booking-portal";
const booking = {
  id: "booking", shopId: "shop", serviceId: "service", staffId: "staff", quantity: 1,
  startAt: DateTime.fromISO("2026-03-02T10:00Z").toJSDate(), status: "CONFIRMED",
  customerName: "Customer", service: { title: "Yoga" }, location: { name: "Studio", timezone: "UTC" },
};
const policy = { customerCancelCutoffHours: 2, customerRescheduleCutoffHours: 1 };
function routeArgs(request: Request) {
  return { request, url: new URL(request.url), pattern: "/booking/:token", params: { token: "test" }, context: {} };
}
function request(intent: string) {
  const body = new URLSearchParams({ intent, idempotencyKey: "request", slot: JSON.stringify({ staffId: "staff", startAt: "2026-03-05T10:00Z" }) });
  return new Request("https://booknest.example/booking/test", { method: "POST", body });
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(DateTime.fromISO("2026-03-02T08:00Z").toMillis());
  vi.clearAllMocks(); mocks.resolve.mockResolvedValue(booking); mocks.service.mockResolvedValue(policy);
  mocks.slots.mockResolvedValue({ timezone: "UTC", slots: [] });
});
afterEach(() => vi.useRealTimers());
describe("customer portal policy", () => {
  it("keeps separate cancellation and rescheduling permissions", async () => {
    const result = await loader(routeArgs(new Request("https://booknest.example/booking/test?date=2026-03-05")));
    expect(result.changeErrors.cancel).toMatch(/Cancellation/);
    expect(result.changeErrors.reschedule).toBeNull();
    expect(mocks.slots).toHaveBeenCalledOnce();
  });
  it("does not query replacement times once rescheduling closes", async () => {
    vi.setSystemTime(DateTime.fromISO("2026-03-02T09:00Z").toMillis());
    const result = await loader(routeArgs(new Request("https://booknest.example/booking/test?date=2026-03-05")));
    expect(result.changeErrors.reschedule).toMatch(/Rescheduling/);
    expect(result.slots).toBeNull();
    expect(mocks.slots).not.toHaveBeenCalled();
  });
  it("rejects a direct cancellation POST at the deadline", async () => {
    const result = await action(routeArgs(request("cancel")));
    expect(result).toMatchObject({ error: expect.stringMatching(/Cancellation/) });
    expect(mocks.cancel).not.toHaveBeenCalled();
  });
  it("marks allowed cancellations for policy enforcement under the booking lock", async () => {
    vi.setSystemTime(DateTime.fromISO("2026-03-02T07:00Z").toMillis());
    await action(routeArgs(request("cancel")));
    expect(mocks.cancel).toHaveBeenCalledWith("shop", "booking", expect.objectContaining({ customer: true }));
  });
  it("marks allowed rescheduling for policy enforcement under the booking lock", async () => {
    await action(routeArgs(request("reschedule")));
    expect(mocks.reschedule).toHaveBeenCalledWith("shop", "booking", expect.any(Object), expect.any(Object), undefined, { customer: true });
  });
  it("rejects changes to a non-confirmed booking", async () => {
    mocks.resolve.mockResolvedValue({ ...booking, status: "CANCELLED" });
    const result = await action(routeArgs(request("reschedule")));
    expect(result).toMatchObject({ error: expect.stringMatching(/cannot be changed/) });
    expect(mocks.reschedule).not.toHaveBeenCalled();
  });
});
