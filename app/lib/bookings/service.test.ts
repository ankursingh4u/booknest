import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DateTime, Settings } from "luxon";
const state = vi.hoisted(() => ({ tx: {} as Record<string, any>, run: vi.fn() }));
vi.mock("../../db.server", () => ({ getShopDatabase: () => state.tx, withShopTransaction: (...args: unknown[]) => state.run(...args) }));
import { createBooking, createReservation, rescheduleBooking, cancelBooking, joinWaitlist } from "./service.server";
const input = { serviceId: "service", staffId: "staff", startAt: "2026-10-19T09:00:00Z", quantity: 1, idempotencyKey: "8adf23e1-653e-4ac4-8db7-e0cfe5350c28" };
const customer = { email: "customer@example.com", name: "Customer" };
const now = DateTime.fromISO("2026-10-18T00:00Z", { zone: "utc" });
afterEach(() => vi.restoreAllMocks());
beforeEach(() => {
  const service = { id: "service", active: true, locationId: "location", durationMin: 60, capacity: 2, bufferBefore: 0, bufferAfter: 0,
    minNoticeHours: 0, maxAdvanceDays: 90, priceCents: 1000, variantId: "gid://shopify/ProductVariant/123" };
  state.tx = {
    service: { findFirst: vi.fn().mockResolvedValue(service) }, location: { findFirst: vi.fn().mockResolvedValue({ id: "location", active: true, timezone: "UTC" }) },
    staffMember: { findMany: vi.fn().mockResolvedValue([{ id: "staff", firstName: "A", lastName: "B" }]) },
    serviceStaff: { findMany: vi.fn().mockResolvedValue([{ staffId: "staff" }]), findFirst: vi.fn().mockResolvedValue({ serviceId: "service", staffId: "staff" }) },
    waitlistEntry: { create: vi.fn().mockImplementation(({ data }) => ({ ...data, id: "waitlist-entry" })) },
    availabilityRule: { findMany: vi.fn().mockResolvedValue([{ staffId: "staff", serviceId: null, weekday: 1, startTime: "09:00", endTime: "12:00", timezone: "UTC" }]) },
    additionalHours: { findMany: vi.fn().mockResolvedValue([]) },
    blackout: { findMany: vi.fn().mockResolvedValue([]) }, timeOffRequest: { findMany: vi.fn().mockResolvedValue([]) },
    booking: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockImplementation(({ data }) => ({ ...data, id: "booking" })) },
    reservation: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockImplementation(({ data }) => ({ ...data, id: "hold" })) },
    shop: { findUniqueOrThrow: vi.fn().mockResolvedValue({ currency: "USD", domain: "shop.myshopify.com" }) },
    notificationTask: { createMany: vi.fn(), create: vi.fn() },
    intakeQuestion: { findMany: vi.fn().mockResolvedValue([]) }, intakeAnswer: { createMany: vi.fn() },
  };
  state.run.mockReset().mockImplementation((_shop, work) => work(state.tx));
});
describe("booking reservation transactions", () => {
  it("holds capacity under an Availability lock with server-set expiry and price", async () => {
    const hold = await createReservation("shop", { ...input, priceCents: 1 }, now);
    expect(state.run.mock.calls[0]?.[2]).toEqual(["staff"]);
    expect(hold.priceCents).toBe(1000);
    expect(hold.expiresAt.toISOString()).toBe("2026-10-18T00:15:00.000Z");
  });
  it("rejects a full slot without writing a hold", async () => {
    state.tx.booking.findMany.mockResolvedValue([{ serviceId: "service", staffId: "staff", status: "CONFIRMED", quantity: 2,
      startAt: new Date("2026-10-19T09:00Z"), endAt: new Date("2026-10-19T10:00Z"), service: { bufferBefore: 0, bufferAfter: 0 } }]);
    await expect(createReservation("shop", input, now)).rejects.toThrow("no longer available");
    expect(state.tx.reservation.create).not.toHaveBeenCalled();
  });
  it("reuses an identical hold without reserving extra seats", async () => {
    state.tx.reservation.findUnique.mockResolvedValue({ ...input, id: "previous", startAt: new Date(input.startAt), expiresAt: now.plus({ minutes: 5 }).toJSDate(), booking: null });
    expect((await createReservation("shop", input, now)).id).toBe("previous");
    expect(state.tx.reservation.create).not.toHaveBeenCalled();
  });
  it("cannot bypass payment using the free booking endpoint", async () => {
    await expect(createBooking("shop", input, customer, "free", now)).rejects.toThrow("Shopify checkout");
    expect(state.tx.booking.create).not.toHaveBeenCalled();
  });
  it("requires intake answers before storing a booking", async () => {
    state.tx.intakeQuestion.findMany.mockResolvedValue([{ id: "q", required: true, label: "Access needs", options: [] }]);
    await expect(createBooking("shop", input, customer, "manual", now)).rejects.toThrow("Access needs");
    expect(state.tx.booking.create).not.toHaveBeenCalled();
  });
  it("records confirmation and reminders atomically with the booking", async () => {
    await createBooking("shop", input, customer, "manual", now);
    expect(state.tx.notificationTask.createMany).toHaveBeenCalledOnce();
    expect(state.tx.notificationTask.createMany.mock.calls[0][0].data.map((task: { kind: string }) => task.kind)).toEqual(["CONFIRMATION", "REMINDER_24H", "REMINDER_1H", "CALENDAR_SYNC"]);
  });
  it("allows an authorized manual booking and snapshots the contact information", async () => {
    const booking = await createBooking("shop", input, customer, "manual", now);
    expect(booking.status).toBe("CONFIRMED");
    expect(booking.customerEmail).toBe(customer.email);
    expect(booking.priceCents).toBe(1000);
  });
});

describe("rescheduling and paid-booking recovery", () => {
  function existing(status: string) {
    const booking = { id: "booking", staffId: "staff", serviceId: "service", quantity: 1, status,
      startAt: new Date("2026-10-19T10:00Z"), endAt: new Date("2026-10-19T11:00Z"), checkedInAt: new Date("2026-10-19T10:00Z") };
    state.tx.booking.findUnique.mockResolvedValue(booking);
    state.tx.booking.findUniqueOrThrow = vi.fn().mockResolvedValue(booking);
    state.tx.booking.update = vi.fn().mockImplementation(async ({ data }) => ({ ...booking, ...data }));
  }
  it("clears old check-in when an appointment moves", async () => {
    existing("CONFIRMED");
    const booking = await rescheduleBooking("shop", "booking", input, now);
    expect(booking.checkedInAt).toBeNull();
    expect(booking.checkedInBy).toBeNull();
  });
  it("does not let the customer portal confirm a paid booking under review", async () => {
    existing("NEEDS_REVIEW");
    await expect(rescheduleBooking("shop", "booking", input, now)).rejects.toThrow("cannot be rescheduled");
  });
  it("lets a merchant resolve a reviewed payment into an available slot", async () => {
    existing("NEEDS_REVIEW");
    const booking = await rescheduleBooking("shop", "booking", input, now, customer);
    expect(booking.status).toBe("CONFIRMED");
    expect(booking.customerEmail).toBe(customer.email);
    expect(state.tx.notificationTask.createMany.mock.calls[0][0].data[0].kind).toBe("CONFIRMATION");
  });
});

describe("booking changes during mutation", () => {
  function setupChangedRecord() {
    const read = { id: "booking", staffId: "staff", serviceId: "service", quantity: 1, status: "CONFIRMED",
      startAt: new Date("2026-10-19T10:00Z"), endAt: new Date("2026-10-19T11:00Z") };
    state.tx.booking.findUnique.mockResolvedValue(read);
    state.tx.booking.findUniqueOrThrow = vi.fn().mockResolvedValue(read);
    return read;
  }
  it("cannot revive a cancellation that commits during rescheduling", async () => {
    const read = setupChangedRecord();
    let committed = { ...read, status: "CANCELLED" };
    state.tx.booking.update = vi.fn().mockImplementation(async ({ where, data }: { where: Record<string, any>; data: Record<string, any> }) => {
      if (where.status && where.status !== committed.status) throw { code: "P2025" };
      committed = { ...committed, ...data }; return committed;
    });
    await expect(rescheduleBooking("shop", "booking", input, now)).rejects.toThrow("changed");
    expect(committed.status).toBe("CANCELLED");
    expect(state.tx.notificationTask.createMany).not.toHaveBeenCalled();
  });
  it("retries cancellation when the appointment moves to a different Availability", async () => {
    const read = setupChangedRecord();
    let committed = { ...read, staffId: "other-staff" };
    state.tx.booking.update = vi.fn().mockImplementation(async ({ where, data }: { where: Record<string, any>; data: Record<string, any> }) => {
      if (where.staffId && where.staffId !== committed.staffId) throw { code: "P2025" };
      committed = { ...committed, ...data }; return committed;
    });
    await expect(cancelBooking("shop", "booking")).rejects.toThrow("changed");
    expect(committed.status).toBe("CONFIRMED");
  });
});

describe("customer cutoff revalidation under the Availability lock", () => {
  const beforeDeadline = DateTime.utc(2026, 10, 19, 7, 59, 59);
  const deadline = DateTime.utc(2026, 10, 19, 8);
  function setupCustomerBooking() {
    const record = { id: "booking", staffId: "staff", serviceId: "service", quantity: 1, status: "CONFIRMED",
      startAt: DateTime.fromISO("2026-10-19T10:00:00Z").toJSDate(), endAt: DateTime.fromISO("2026-10-19T11:00:00Z").toJSDate() };
    state.tx.booking.findUnique.mockResolvedValue(record);
    state.tx.booking.findUniqueOrThrow = vi.fn().mockResolvedValue(record);
    state.tx.booking.update = vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...record, ...data }));
    state.tx.service.findFirstOrThrow = vi.fn().mockResolvedValue({ customerCancelCutoffHours: 2, customerRescheduleCutoffHours: 2 });
    return record;
  }
  it("closes customer cancellation if the deadline passes while waiting for the lock", async () => {
    setupCustomerBooking();
    let actualClock = beforeDeadline;
    vi.spyOn(Settings, "now").mockImplementation(() => actualClock.toMillis());
    state.run.mockImplementation(async (_shop, work) => { actualClock = deadline; return work(state.tx); });
    await expect(cancelBooking("shop", "booking", { customer: true })).rejects.toThrow("Cancellation closes 2 hours");
    expect(state.run.mock.calls[0]?.[2]).toEqual(["staff"]);
    expect(state.tx.service.findFirstOrThrow).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "service" } }));
    expect(state.tx.booking.update).not.toHaveBeenCalled();
    expect(state.tx.notificationTask.createMany).not.toHaveBeenCalled();
  });
  it("does not use a reschedule request's earlier captured time to bypass the locked cutoff", async () => {
    setupCustomerBooking();
    let actualClock = beforeDeadline;
    vi.spyOn(Settings, "now").mockImplementation(() => actualClock.toMillis());
    state.run.mockImplementation(async (_shop, work) => { actualClock = deadline; return work(state.tx); });
    await expect(rescheduleBooking("shop", "booking", input, beforeDeadline, undefined, { customer: true })).rejects.toThrow("Rescheduling closes 2 hours");
    expect(state.tx.booking.update).not.toHaveBeenCalled();
    expect(state.tx.notificationTask.createMany).not.toHaveBeenCalled();
  });
  it("checks the locked booking's earlier start rather than the stale initial read", async () => {
    const current = setupCustomerBooking();
    state.tx.booking.findUnique.mockResolvedValue({ ...current,
      startAt: DateTime.fromISO("2026-10-19T12:00:00Z").toJSDate(), endAt: DateTime.fromISO("2026-10-19T13:00:00Z").toJSDate() });
    await expect(cancelBooking("shop", "booking", { customer: true, now: deadline })).rejects.toThrow("Cancellation closes 2 hours");
    expect(state.tx.booking.update).not.toHaveBeenCalled();
  });
  it("reloads the policy inside the lock when the merchant has tightened the cutoff", async () => {
    setupCustomerBooking();
    let lockAcquired = false;
    state.tx.service.findFirstOrThrow.mockImplementation(async () => {
      expect(lockAcquired).toBe(true);
      return { customerCancelCutoffHours: 2, customerRescheduleCutoffHours: 2 };
    });
    state.run.mockImplementation(async (_shop, work) => { lockAcquired = true; return work(state.tx); });
    await expect(rescheduleBooking("shop", "booking", input, beforeDeadline, undefined, { customer: true, now: deadline })).rejects.toThrow("Rescheduling closes 2 hours");
    expect(state.tx.booking.update).not.toHaveBeenCalled();
    expect(state.tx.notificationTask.createMany).not.toHaveBeenCalled();
  });
  it("accepts customer cancellation immediately before the deadline using the explicit test clock", async () => {
    setupCustomerBooking();
    const result = await cancelBooking("shop", "booking", { customer: true, now: beforeDeadline });
    expect(result.status).toBe("CANCELLED");
    expect(state.tx.booking.update).toHaveBeenCalledOnce();
    expect(state.tx.notificationTask.createMany).toHaveBeenCalledOnce();
  });
  it("rejects customer rescheduling at the exact cutoff with no booking or outbox writes", async () => {
    setupCustomerBooking();
    await expect(rescheduleBooking("shop", "booking", input, beforeDeadline, undefined, { customer: true, now: deadline })).rejects.toThrow("Rescheduling closes 2 hours");
    expect(state.tx.booking.update).not.toHaveBeenCalled();
    expect(state.tx.notificationTask.createMany).not.toHaveBeenCalled();
  });
  it("preserves merchant authority to cancel after the customer deadline", async () => {
    setupCustomerBooking();
    const result = await cancelBooking("shop", "booking", { now: deadline });
    expect(result.status).toBe("CANCELLED");
    expect(state.tx.service.findFirstOrThrow).not.toHaveBeenCalled();
  });
});

describe("waitlist", () => {
  const waitlistValues = { serviceId: "service", staffId: "staff", date: "2026-10-19", email: "customer@example.com" };
  it("records a full day's desired window in the location's own timezone", async () => {
    const entry = await joinWaitlist("shop", waitlistValues, now);
    expect(entry.customerEmail).toBe("customer@example.com");
    expect(entry.desiredStart.toISOString()).toBe("2026-10-19T00:00:00.000Z");
    expect(entry.desiredEnd.toISOString()).toBe("2026-10-19T23:59:59.999Z");
  });
  it("rejects a staff member not assigned to the Event/Service", async () => {
    state.tx.serviceStaff.findFirst.mockResolvedValue(null);
    await expect(joinWaitlist("shop", waitlistValues, now)).rejects.toThrow("assigned to this Event/Service");
    expect(state.tx.waitlistEntry.create).not.toHaveBeenCalled();
  });
  it("rejects a past date", async () => {
    await expect(joinWaitlist("shop", { ...waitlistValues, date: "2026-10-01" }, now)).rejects.toThrow("current or future date");
    expect(state.tx.waitlistEntry.create).not.toHaveBeenCalled();
  });
  it("rejects a malformed email", async () => {
    await expect(joinWaitlist("shop", { ...waitlistValues, email: "not-an-email" }, now)).rejects.toThrow();
    expect(state.tx.waitlistEntry.create).not.toHaveBeenCalled();
  });
});
