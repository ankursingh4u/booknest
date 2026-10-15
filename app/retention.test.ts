import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  expired: [] as { id: string; shopId: string }[],
  tx: {} as Record<string, any>,
}));
vi.mock("@prisma/client", async importOriginal => {
  const actual = await importOriginal<typeof import("@prisma/client")>();
  return { ...actual, PrismaClient: class {
    booking = { findMany: vi.fn().mockImplementation(async () => state.expired) };
    $transaction(work: (tx: unknown) => unknown) { return work(state.tx); }
  } };
});
import { purgeExpiredCustomerData } from "./db.server";

beforeEach(() => {
  state.expired = [
    { id: "booking-a1", shopId: "shop-a" },
    { id: "booking-a2", shopId: "shop-a" },
    { id: "booking-b1", shopId: "shop-b" },
  ];
  state.tx = Object.fromEntries(["notificationTask", "intakeAnswer"].map(key => [key, { deleteMany: vi.fn() }]));
  state.tx.booking = { updateMany: vi.fn() };
  state.tx.shop = { findFirst: vi.fn().mockResolvedValue({ id: "shop" }) };
});

it("anonymizes every expired booking's customer PII while keeping the booking row", async () => {
  await purgeExpiredCustomerData(new Date("2024-01-01"));
  expect(state.tx.booking.updateMany).toHaveBeenCalledWith({
    where: { id: { in: ["booking-a1", "booking-a2"] }, AND: [{ shopId: "shop-a" }] },
    data: { customerId: null, customerEmail: "", customerName: null, customerPhone: null, notes: null, shopId: "shop-a" },
  });
  expect(state.tx.booking.updateMany).toHaveBeenCalledWith({
    where: { id: { in: ["booking-b1"] }, AND: [{ shopId: "shop-b" }] },
    data: { customerId: null, customerEmail: "", customerName: null, customerPhone: null, notes: null, shopId: "shop-b" },
  });
});

it("deletes notification tasks and intake answers tied to expired bookings", async () => {
  await purgeExpiredCustomerData(new Date("2024-01-01"));
  expect(state.tx.notificationTask.deleteMany).toHaveBeenCalledWith({ where: { bookingId: { in: ["booking-a1", "booking-a2"] }, AND: [{ shopId: "shop-a" }] } });
  expect(state.tx.intakeAnswer.deleteMany).toHaveBeenCalledWith({ where: { bookingId: { in: ["booking-a1", "booking-a2"] }, AND: [{ booking: { shopId: "shop-a" } }] } });
});

it("returns the count of expired bookings found", async () => {
  await expect(purgeExpiredCustomerData(new Date("2024-01-01"))).resolves.toBe(3);
});

it("does nothing when no bookings have expired", async () => {
  state.expired = [];
  await purgeExpiredCustomerData(new Date("2024-01-01"));
  expect(state.tx.booking.updateMany).not.toHaveBeenCalled();
});
