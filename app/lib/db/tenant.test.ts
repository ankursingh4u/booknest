import { describe, expect, it } from "vitest";
import { scopeTenantQuery } from "./tenant.server";

const shopId = "shop-a";

describe("scopeTenantQuery", () => {
  it.each(["findMany", "findFirst", "findFirstOrThrow", "count", "aggregate", "groupBy", "updateMany", "deleteMany"])("scopes %s even without a caller filter", (operation) => {
    expect(scopeTenantQuery("Service", operation, {}, shopId).where).toEqual({ AND: [{ shopId }] });
  });

  it("keeps unique selectors and intersects an OR filter with the tenant", () => {
    const where = { id: "booking-a", OR: [{ shopId: "shop-b" }, { status: "CONFIRMED" }] };
    expect(scopeTenantQuery("Booking", "findUnique", { where }, shopId).where).toEqual({ ...where, AND: [{ shopId }] });
    expect(where).not.toHaveProperty("AND");
  });

  it("preserves existing AND conditions", () => {
    expect(scopeTenantQuery("Booking", "findMany", { where: { AND: { status: "CONFIRMED" } } }, shopId).where)
      .toEqual({ AND: [{ status: "CONFIRMED" }, { shopId }] });
  });

  it("scopes Shop by its primary key", () => {
    expect(scopeTenantQuery("Shop", "findUnique", { where: { domain: "a.myshopify.com" } }, shopId).where)
      .toEqual({ domain: "a.myshopify.com", AND: [{ id: shopId }] });
  });

  it.each([
    ["ServiceStaff", { service: { shopId }, staff: { shopId } }],
    ["IntakeAnswer", { booking: { shopId } }],
    ["JobLog", { booking: { is: { shopId } } }],
  ])("scopes relation-owned %s records", (model, filter) => {
    expect(scopeTenantQuery(model as string, "findMany", {}, shopId).where).toEqual({ AND: [filter] });
  });

  it("injects ownership into creates without mutating input", () => {
    const data = { title: "Consultation" };
    expect(scopeTenantQuery("Service", "create", { data }, shopId).data).toEqual({ ...data, shopId });
    expect(data).not.toHaveProperty("shopId");
  });

  it("injects ownership into every createMany row", () => {
    expect(scopeTenantQuery("Location", "createMany", { data: [{ name: "A" }, { name: "B", shopId }] }, shopId).data)
      .toEqual([{ name: "A", shopId }, { name: "B", shopId }]);
  });

  it("guards both upsert branches", () => {
    const result = scopeTenantQuery("Service", "upsert", {
      where: { id: "service-a" }, create: { title: "A" }, update: { title: "B" },
    }, shopId);
    expect(result.where).toEqual({ id: "service-a", AND: [{ shopId }] });
    expect(result.create).toEqual({ title: "A", shopId });
    expect(result.update).toEqual({ title: "B", shopId });
  });

  it.each(["create", "update", "updateMany"])("rejects tenant reassignment through %s", (operation) => {
    expect(() => scopeTenantQuery("Service", operation, { data: { shopId: "shop-b" } }, shopId)).toThrow(/ownership/i);
    expect(() => scopeTenantQuery("Service", operation, { data: { shopId: { set: "shop-b" } } }, shopId)).toThrow(/ownership/i);
  });

  it("rejects nested writes that could cross tenants", () => {
    expect(() => scopeTenantQuery("Service", "update", { data: { staff: { connect: { staffId: "staff-b" } } } }, shopId)).toThrow(/nested/i);
    expect(() => scopeTenantQuery("Shop", "update", { data: { services: { deleteMany: {} } } }, shopId)).toThrow(/nested/i);
  });

  it("rejects shop identity changes and bootstrapping through a tenant client", () => {
    expect(() => scopeTenantQuery("Shop", "update", { data: { id: "shop-b" } }, shopId)).toThrow(/ownership/i);
    expect(() => scopeTenantQuery("Shop", "create", { data: { domain: "b.myshopify.com" } }, shopId)).toThrow(/bootstrap/i);
  });

  it("rejects creates for models that need relationship-specific repositories", () => {
    expect(() => scopeTenantQuery("IntakeAnswer", "create", { data: { bookingId: "booking-b" } }, shopId)).toThrow(/repository/i);
  });

  it("fails closed for unknown models, operations, and missing tenants", () => {
    expect(() => scopeTenantQuery("NewModel", "findMany", {}, shopId)).toThrow(/model/i);
    expect(() => scopeTenantQuery("Service", "unexpected", {}, shopId)).toThrow(/operation/i);
    expect(() => scopeTenantQuery("Service", "findMany", {}, " ")).toThrow(/shopId/i);
  });
});

describe("additional hours tenant ownership", () => {
  it("scopes reads, writes, and deletes to the current shop", () => {
    expect(scopeTenantQuery("AdditionalHours", "findMany", {}, shopId).where).toEqual({ AND: [{ shopId }] });
    expect(scopeTenantQuery("AdditionalHours", "create", { data: { locationId: "loc" } }, shopId).data).toEqual({ locationId: "loc", shopId });
    expect(scopeTenantQuery("AdditionalHours", "delete", { where: { id: "hours-b" } }, shopId).where).toEqual({ id: "hours-b", AND: [{ shopId }] });
    expect(() => scopeTenantQuery("AdditionalHours", "update", { data: { shopId: "other" } }, shopId)).toThrow(/ownership/);
  });
});
