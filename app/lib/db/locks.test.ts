import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ execute: vi.fn(), tx: {} as Record<string, any> }));
vi.mock("@prisma/client", async importOriginal => {
  const actual = await importOriginal<typeof import("@prisma/client")>();
  return { ...actual, PrismaClient: class {
    $transaction(work: (tx: unknown) => unknown) { return work(state.tx); }
  } };
});
import { withShopTransaction } from "../../db.server";
beforeEach(() => { state.execute.mockReset().mockResolvedValue(1); state.tx = { $executeRaw: state.execute }; });
it("takes shop/order locks before sorted Availability locks to avoid cancellation deadlock", async () => {
  await withShopTransaction("shop-a", async () => "done", ["staff-z", "staff-a", "staff-z"], ["42", "42"]);
  expect(state.execute.mock.calls.map(call => call[1])).toEqual(["shop-a:order:42", "shop-a:staff-a", "shop-a:staff-z"]);
});
