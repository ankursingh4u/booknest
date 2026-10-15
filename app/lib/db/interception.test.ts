import { describe, expect, it } from "vitest";
import { getShopDatabase } from "../../db.server";

// A final query extension returns intercepted arguments, so these tests exercise
// Prisma's real dispatch without contacting PostgreSQL.
function capturedDatabase() {
  return getShopDatabase("shop-a").$extends({
    query: {
      async $allOperations({ args }) { return args as never; },
    },
  });
}

describe("real Prisma tenant dispatch", () => {
  it("applies tenant filters before the query reaches the next extension", async () => {
    const result = await capturedDatabase().service.findMany({ where: { active: true } });
    expect(result).toEqual({ where: { active: true, AND: [{ shopId: "shop-a" }] } });
  });

  it("preserves unique IDs while restricting ownership", async () => {
    const result = await capturedDatabase().booking.findUnique({ where: { id: "booking-b" } });
    expect(result).toEqual({ where: { id: "booking-b", AND: [{ shopId: "shop-a" }] } });
  });

  it("blocks raw queries through the real raw SQL dispatch", async () => {
    await expect(capturedDatabase().$queryRawUnsafe("SELECT 1")).rejects.toThrow(/raw queries/i);
  });

  it("blocks unsafe nested writes before Prisma executes them", async () => {
    await expect(capturedDatabase().shop.update({
      where: { id: "shop-a" }, data: { services: { deleteMany: {} } },
    })).rejects.toThrow(/nested/i);
  });
});
