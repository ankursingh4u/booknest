import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({ extend: vi.fn(), shop: vi.fn(), location: vi.fn(), staffMember: vi.fn(), service: vi.fn(), booking: vi.fn(), intakeQuestion: vi.fn() }));
vi.mock("@prisma/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@prisma/client")>();
  return {
    ...actual,
    PrismaClient: class {
      $extends = mocked.extend;
      shop = { findFirst: mocked.shop };
      location = { findFirst: mocked.location };
      staffMember = { findFirst: mocked.staffMember };
      service = { findFirst: mocked.service };
      booking = { findFirst: mocked.booking };
      intakeQuestion = { findFirst: mocked.intakeQuestion };
    },
  };
});
import { getShopDatabase } from "./db.server";

type Interceptor = (request: {
  model?: string; operation: string; args: Record<string, unknown>;
  query: (args: Record<string, unknown>) => Promise<unknown>;
}) => Promise<unknown>;
function interceptor(shopId = "shop-a"): Interceptor {
  getShopDatabase(shopId);
  return mocked.extend.mock.calls.at(-1)![0].query.$allOperations;
}

describe("tenant database interception", () => {
  beforeEach(() => { vi.clearAllMocks(); mocked.shop.mockResolvedValue({ id: "shop-a" }); });

  it("scopes reads through the actual Prisma extension hook", async () => {
    const query = vi.fn().mockResolvedValue([]);
    await interceptor()({ model: "Booking", operation: "findMany", args: {}, query });
    expect(query).toHaveBeenCalledWith({ where: { AND: [{ shopId: "shop-a" }] } });
  });

  it("rejects unscoped raw SQL before dispatch", async () => {
    const query = vi.fn();
    await expect(interceptor()({ operation: "$queryRaw", args: {}, query })).rejects.toThrow(/raw/i);
    expect(query).not.toHaveBeenCalled();
  });

  it("rejects a foreign location before creating a service", async () => {
    mocked.location.mockResolvedValue(null);
    const query = vi.fn();
    await expect(interceptor()({ model: "Service", operation: "create", args: { data: { locationId: "location-b", title: "A" } }, query })).rejects.toThrow(/does not belong/i);
    expect(mocked.location).toHaveBeenCalledWith({ where: { id: "location-b", AND: [{ shopId: "shop-a" }] } });
    expect(query).not.toHaveBeenCalled();
  });

  it("permits owned foreign references and preserves the result", async () => {
    mocked.location.mockResolvedValue({ id: "location-a" });
    const query = vi.fn().mockResolvedValue({ id: "service-a" });
    await expect(interceptor()({ model: "Service", operation: "create", args: { data: { locationId: "location-a", title: "A" } }, query })).resolves.toEqual({ id: "service-a" });
    expect(query).toHaveBeenCalledWith({ data: { locationId: "location-a", title: "A", shopId: "shop-a" } });
  });

  it("checks foreign-key reassignment through set updates", async () => {
    mocked.location.mockResolvedValue(null);
    const query = vi.fn();
    await expect(interceptor()({ model: "Service", operation: "update", args: { where: { id: "service-a" }, data: { locationId: { set: "location-b" } } }, query })).rejects.toThrow(/does not belong/i);
    expect(query).not.toHaveBeenCalled();
  });

  it("checks every row before a bulk create", async () => {
    mocked.location.mockResolvedValueOnce({ id: "location-a" }).mockResolvedValueOnce(null);
    const query = vi.fn();
    await expect(interceptor()({ model: "Service", operation: "createMany", args: { data: [{ locationId: "location-a" }, { locationId: "location-b" }] }, query })).rejects.toThrow(/does not belong/i);
    expect(query).not.toHaveBeenCalled();
  });

  it("does not allow indirect records to lose their ownership relation", async () => {
    const query = vi.fn();
    await expect(interceptor()({ model: "JobLog", operation: "update", args: { where: { id: "job-a" }, data: { bookingId: null } }, query })).rejects.toThrow(/detached/i);
    expect(query).not.toHaveBeenCalled();
  });

  it("checks location ID arrays as well as Prisma relation fields", async () => {
    mocked.location.mockResolvedValue(null);
    const query = vi.fn();
    await expect(interceptor()({ model: "StaffMember", operation: "update", args: { where: { id: "staff-a" }, data: { locationIds: ["location-b"] } }, query })).rejects.toThrow(/does not belong/i);
    expect(query).not.toHaveBeenCalled();
  });

  it("rejects unchecked location array pushes", async () => {
    const query = vi.fn();
    await expect(interceptor()({ model: "StaffMember", operation: "update", args: { where: { id: "staff-a" }, data: { locationIds: { push: "location-b" } } }, query })).rejects.toThrow(/explicit list/i);
    expect(query).not.toHaveBeenCalled();
  });


  it.each([
    ["TeamSeat", { staffId: "staff-b" }],
    ["WaitlistEntry", { serviceId: "service-b" }],
    ["IntakeAnswer", { questionId: "question-b" }],
  ])("checks undeclared scalar references on %s", async (model, data) => {
    mocked.staffMember.mockResolvedValue(null);
    mocked.service.mockResolvedValue(null);
    mocked.intakeQuestion.mockResolvedValue(null);
    const query = vi.fn();
    await expect(interceptor()({ model: model as string, operation: "update", args: { where: { id: "record-a" }, data }, query })).rejects.toThrow(/does not belong/i);
    expect(query).not.toHaveBeenCalled();
  });

  it("rejects invalid tenant context before constructing a client", () => {
    expect(() => getShopDatabase("")).toThrow(/shopId/i);
    expect(mocked.extend).not.toHaveBeenCalled();
  });
});
