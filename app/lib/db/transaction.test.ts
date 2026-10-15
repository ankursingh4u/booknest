import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { tenantTransaction } from "./transaction.server";
describe("tenant transaction", () => {
  it("checks foreign references inside the same transaction", async () => {
    const tx = { location: { findFirst: vi.fn().mockResolvedValue({ id: "new" }) },
      shop: { findFirst: vi.fn().mockResolvedValue({ id: "shop" }) },
      staffMember: { create: vi.fn().mockResolvedValue({ id: "staff" }) } };
    await tenantTransaction(tx as unknown as Prisma.TransactionClient, "shop").staffMember.create({
      data: { shopId: "shop", firstName: "A", lastName: "B", email: "a@example.com", timezone: "UTC", locationIds: ["new"] },
    });
    expect(tx.location.findFirst).toHaveBeenCalledWith({ where: { id: "new", AND: [{ shopId: "shop" }] } });
    expect(tx.staffMember.create).toHaveBeenCalledOnce();
  });
  it("allows relation creation only after checking both owners", async () => {
    const tx = { service: { findFirst: vi.fn().mockResolvedValue({}) }, staffMember: { findFirst: vi.fn().mockResolvedValue(null) },
      serviceStaff: { create: vi.fn() } };
    await expect(tenantTransaction(tx as unknown as Prisma.TransactionClient, "shop").serviceStaff.create({
      data: { serviceId: "mine", staffId: "foreign" },
    })).rejects.toThrow("Related record");
    expect(tx.serviceStaff.create).not.toHaveBeenCalled();
  });
  it("intersects every transactional read with the verified tenant", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    await tenantTransaction({ booking: { findMany } } as unknown as Prisma.TransactionClient, "mine").booking.findMany({ where: { shopId: "other" } });
    expect(findMany).toHaveBeenCalledWith({ where: { shopId: "other", AND: [{ shopId: "mine" }] } });
  });
  it("does not expose raw SQL to the transaction callback", () => {
    const scoped = tenantTransaction({} as Prisma.TransactionClient, "mine");
    expect(() => scoped.$queryRaw).toThrow();
  });
});
