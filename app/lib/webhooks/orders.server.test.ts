import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ db: {} as Record<string, any>, run: vi.fn(), available: vi.fn() }));
vi.mock("../../db.server", () => ({ getShopDatabase: () => state.db, withShopTransaction: (...args: unknown[]) => state.run(...args) }));
vi.mock("../bookings/service.server", async importOriginal => {
  const actual = await importOriginal<typeof import("../bookings/service.server")>();
  return { ...actual, availabilityForDay: (...args: unknown[]) => state.available(...args) };
});
import { processOrder, processOrderCancellation } from "./orders.server";
const payload = { id: 1, financial_status: "paid", currency: "USD", email: "a@example.com", line_items: [
  { id: 2, variant_id: 123, quantity: 1, price: "10", properties: [{ name: "_BookNest Reservation", value: "hold" }] },
] };
beforeEach(() => {
  state.run.mockReset().mockImplementation((_shop, work) => work(state.db));
  state.available.mockReset();
  const hold = { id: "hold", serviceId: "service", staffId: "staff", locationId: "location", quantity: 1, variantId: "gid://shopify/ProductVariant/123",
    depositType: "NONE", answers: [], startAt: new Date("2026-11-01T09:00Z"), endAt: new Date("2026-11-01T10:00Z"), priceCents: 1000, currency: "USD" };
  state.db = { service: { findMany: vi.fn().mockResolvedValue([]) }, reservation: { findUnique: vi.fn().mockResolvedValue(hold), findUniqueOrThrow: vi.fn().mockResolvedValue(hold) },
    webhookReceipt: { findFirst: vi.fn().mockResolvedValue({ id: "cancelled-event" }) },
    booking: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockImplementation(({ data }) => ({ ...data, id: "booking" })) },
    location: { findUniqueOrThrow: vi.fn().mockResolvedValue({ timezone: "UTC" }) }, staffMember: { findUniqueOrThrow: vi.fn().mockResolvedValue({ contactLink: null }) },
    notificationTask: { createMany: vi.fn() } };
});
it("honors a cancellation delivered before an older paid event", async () => {
  await processOrder("shop", payload);
  expect(state.db.booking.create.mock.calls[0][0].data.status).toBe("CANCELLED");
  expect(state.db.notificationTask.createMany).not.toHaveBeenCalled();
});
it("does not create a second booking for a replayed paid line", async () => {
  state.db.booking.findFirst.mockResolvedValue({ id: "booking", orderId: "1" });
  await processOrder("shop", payload);
  expect(state.db.booking.create).not.toHaveBeenCalled();
});
it("flags a second paid order attempting to consume the same reservation", async () => {
  state.db.booking.findFirst.mockResolvedValue({ id: "booking", orderId: "different" });
  await expect(processOrder("shop", payload)).rejects.toThrow("another order");
});

it("waits for paid conversion before cancellation reads committed bookings", async () => {
  let releaseCreate!: () => void, enteredCreate!: () => void;
  const gate = new Promise<void>(resolve => { releaseCreate = resolve; });
  const entered = new Promise<void>(resolve => { enteredCreate = resolve; });
  let committed: Record<string, any> | null = null;
  const tails = new Map<string, Promise<void>>();
  state.run.mockImplementation(async (_shop, work, _staff = [], orders: string[] = []) => {
    if (!orders.length) return work(state.db);
    const key = orders[0]!;
    const previous = tails.get(key) ?? Promise.resolve();
    let unlock!: () => void;
    const held = new Promise<void>(resolve => { unlock = resolve; });
    tails.set(key, previous.then(() => held));
    await previous;
    try { return await work(state.db); } finally { unlock(); }
  });
  state.db.webhookReceipt.findFirst.mockResolvedValue(null);
  const hold = await state.db.reservation.findUnique();
  const { DateTime } = await import("luxon");
  state.available.mockResolvedValue({ slots: [{ startAt: DateTime.fromJSDate(hold.startAt), endAt: DateTime.fromJSDate(hold.endAt) }] });
  state.db.booking.create.mockImplementation(async ({ data }: { data: Record<string, any> }) => {
    enteredCreate(); await gate; committed = { ...data, id: "booking" }; return committed;
  });
  state.db.booking.findMany = vi.fn().mockImplementation(async () => committed ? [{ id: "booking" }] : []);
  state.db.booking.findUnique = vi.fn().mockImplementation(async () => committed);
  state.db.booking.findUniqueOrThrow = vi.fn().mockImplementation(async () => committed);
  state.db.booking.update = vi.fn().mockImplementation(async ({ data }) => { committed = { ...committed, ...data }; return committed; });
  const paid = processOrder("shop", payload);
  await entered;
  const cancelled = processOrderCancellation("shop", { id: 1 });
  await new Promise<void>(resolve => setImmediate(resolve));
  const lookedUpBeforeCommit = state.db.booking.findMany.mock.calls.length > 0;
  releaseCreate();
  await Promise.all([paid, cancelled]);
  expect(lookedUpBeforeCommit).toBe(false);
  expect(committed!.status).toBe("CANCELLED");
  expect(state.run.mock.calls.some(call => call[3]?.[0] === "1")).toBe(true);
});

it("surfaces paid linked variants purchased without a booking reservation for merchant review", async () => {
  state.db.service.findMany.mockResolvedValue([{ id: "service", variantId: "gid://shopify/ProductVariant/123" }]);
  await expect(processOrder("shop", { ...payload, line_items: [{ ...payload.line_items[0], properties: [] }] })).rejects.toThrow("without a booking time");
  expect(state.db.service.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ active: true, priceCents: { gt: 0 }, variantId: { in: ["gid://shopify/ProductVariant/123"] } }) }));
  expect(state.db.booking.create).not.toHaveBeenCalled();
});
it("leaves ordinary product orders alone when they have no booking reservation", async () => {
  await expect(processOrder("shop", { ...payload, line_items: [{ ...payload.line_items[0], properties: [] }] })).resolves.toBeUndefined();
  expect(state.db.booking.create).not.toHaveBeenCalled();
});
it("reconciles reserved lines even when a different paid booking line requires manual time selection", async () => {
  state.db.service.findMany.mockResolvedValue([{ id: "service", variantId: "gid://shopify/ProductVariant/123" }]);
  await expect(processOrder("shop", { ...payload, line_items: [{ ...payload.line_items[0], id: 3, properties: [] }, payload.line_items[0]] })).rejects.toThrow("without a booking time");
  expect(state.db.booking.create).toHaveBeenCalledOnce();
});
