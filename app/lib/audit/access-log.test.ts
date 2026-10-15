import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ created: [] as unknown[] }));
vi.mock("../../db.server", () => ({ getShopDatabase: () => ({ accessLog: { create: vi.fn().mockImplementation(({ data }: { data: unknown }) => { state.created.push(data); }) } }) }));
import { logAccess } from "./access-log.server";

beforeEach(() => { state.created = []; });

it("records who viewed how many personal-data records and why", async () => {
  await logAccess("shop-a", "admin", "view_bookings", 12);
  expect(state.created).toEqual([{ shopId: "shop-a", actor: "admin", action: "view_bookings", recordCount: 12 }]);
});

it("does not log when no personal-data records were actually returned", async () => {
  await logAccess("shop-a", "admin", "view_bookings", 0);
  expect(state.created).toEqual([]);
});
