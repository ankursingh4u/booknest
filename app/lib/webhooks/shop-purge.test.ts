import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ closures: [] as { shopId: string; reason: string }[], extraHours: [] as { shopId: string; note: string }[], tx: {} as Record<string, any> }));
vi.mock("@prisma/client", async importOriginal => {
  const actual = await importOriginal<typeof import("@prisma/client")>();
  return { ...actual, PrismaClient: class {
    shop = { findUnique: vi.fn().mockResolvedValue({ domain: "a.myshopify.com" }) };
    $transaction(work: (tx: unknown) => unknown) { return work(state.tx); }
  } };
});
import { purgeShopData } from "../../db.server";
beforeEach(() => {
  state.closures = [{ shopId: "shop-a", reason: "Private closure details" }, { shopId: "shop-b", reason: "Other store" }];
  state.extraHours = [{ shopId: "shop-a", note: "Private schedule" }, { shopId: "shop-b", note: "Other schedule" }];
  state.tx = Object.fromEntries(["session", "notificationTask", "jobLog", "intakeAnswer", "booking", "reservation", "serviceStaff", "service", "staffMember", "location", "shop"].map(key => [key, { deleteMany: vi.fn(), delete: vi.fn() }]));
  state.tx.blackout = { deleteMany: vi.fn().mockImplementation(({ where }) => { state.closures = state.closures.filter(row => row.shopId !== where.shopId); }) };
  state.tx.additionalHours = { deleteMany: vi.fn().mockImplementation(({ where }) => { state.extraHours = state.extraHours.filter(row => row.shopId !== where.shopId); }) };
});
it("shop redaction removes global closures only for the redacted store", async () => {
  await purgeShopData("shop-a");
  expect(state.closures).toEqual([{ shopId: "shop-b", reason: "Other store" }]);
});

it("shop redaction removes extra hours only for the redacted store", async () => {
  await purgeShopData("shop-a");
  expect(state.extraHours).toEqual([{ shopId: "shop-b", note: "Other schedule" }]);
});
