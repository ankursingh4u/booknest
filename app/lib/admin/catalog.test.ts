import { beforeEach, describe, expect, it, vi } from "vitest";
import { mutateCatalog, catalogData } from "./catalog.server";
import { newServiceIdentity } from "../shopify/product-setup.server";
import { serviceSchema } from "./schemas";
const state = vi.hoisted(() => ({ db: {} as Record<string, any>, locks: [] as string[] }));
vi.mock("../../db.server", () => ({
  getShopDatabase: () => state.db,
  withShopTransaction: async (_shopId: string, callback: (db: any) => Promise<unknown>, locks: string[]) => { state.locks = locks; return callback(state.db); },
}));
const key = "3aed6954-030f-4ab8-9a09-8a2af4c33ac0", shopId = "shop-a";
function form(overrides: Record<string, string> = {}) {
  const values = {
    intent: "save", creationKey: key, productMode: "new", variantId: "",
    title: "Yoga", slug: "yoga", locationId: "loc", staffIds: "staff",
    durationMin: "60", capacity: "2", bufferBefore: "0", bufferAfter: "0",
    price: "29.99", depositType: "NONE", depositValue: "0", minNoticeHours: "1", maxAdvanceDays: "60",
    ...overrides,
  };
  const body = new FormData(); for (const [name, value] of Object.entries(values)) body.set(name, value);
  return body;
}
beforeEach(() => {
  state.db = {
    service: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockImplementation(async ({ data }) => data), update: vi.fn().mockImplementation(async ({ where, data }) => ({ id: where.id, ...data })) },
    location: { findFirst: vi.fn().mockResolvedValue({ id: "loc" }) }, staffMember: { count: vi.fn().mockResolvedValue(1) },
    serviceStaff: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }), createMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };
  state.locks = [];
});
describe("paid service product setup validation", () => {
  it("permits a new paid product without requiring a variant ID before it exists", () => {
    expect(serviceSchema.safeParse({ ...Object.fromEntries(form()), staffIds: ["staff"] }).success).toBe(true);
  });
  it("continues requiring a linked variant when choosing an existing paid product", () => {
    expect(serviceSchema.safeParse({ ...Object.fromEntries(form({ productMode: "existing" })), staffIds: ["staff"] }).success).toBe(false);
  });
  it("validates the local catalog before creating the Shopify product and persists only its returned variant", async () => {
    const verify = vi.fn(), createProduct = vi.fn().mockResolvedValue({ variantId: "gid://shopify/ProductVariant/123" });
    const result = await mutateCatalog(shopId, "services", form(), verify, createProduct);
    const identity = newServiceIdentity(shopId, key);
    expect(createProduct).toHaveBeenCalledWith(expect.objectContaining({ shopId, serviceId: identity, title: "Yoga", priceCents: 2999 }));
    expect(verify).toHaveBeenCalledWith("gid://shopify/ProductVariant/123", 2999);
    expect(result).toMatchObject({ id: identity, variantId: "gid://shopify/ProductVariant/123" });
    expect(state.db.service.create.mock.calls[0][0].data).not.toHaveProperty("productMode");
    expect(state.locks).toContain("service:" + identity);
  });
  it("checks an edit belongs to this store before any Shopify request", async () => {
    const verify = vi.fn(), createProduct = vi.fn();
    await expect(mutateCatalog(shopId, "services", form({ id: "foreign-service" }), verify, createProduct)).rejects.toThrow("store");
    expect(createProduct).not.toHaveBeenCalled(); expect(verify).not.toHaveBeenCalled();
  });
  it("rejects unavailable locations before any Shopify request", async () => {
    state.db.location.findFirst.mockResolvedValue(null);
    const verify = vi.fn(), createProduct = vi.fn();
    await expect(mutateCatalog(shopId, "services", form(), verify, createProduct)).rejects.toThrow("location");
    expect(createProduct).not.toHaveBeenCalled(); expect(verify).not.toHaveBeenCalled();
  });
  it("rejects staff from another location before any Shopify request", async () => {
    state.db.staffMember.count.mockResolvedValue(0);
    const verify = vi.fn(), createProduct = vi.fn();
    await expect(mutateCatalog(shopId, "services", form(), verify, createProduct)).rejects.toThrow("Availability");
    expect(createProduct).not.toHaveBeenCalled(); expect(verify).not.toHaveBeenCalled();
  });
  it("rejects an already-used URL name before creating a product", async () => {
    state.db.service.findFirst.mockImplementation(async ({ where }: { where: { slug?: string; id?: string } }) => where.slug ? { id: "existing-yoga" } : null);
    const verify = vi.fn(), createProduct = vi.fn();
    await expect(mutateCatalog(shopId, "services", form(), verify, createProduct)).rejects.toThrow("URL name");
    expect(createProduct).not.toHaveBeenCalled(); expect(verify).not.toHaveBeenCalled();
  });
  it("replays a completed creation without creating a second service or Shopify product", async () => {
    const values = serviceSchema.parse({ ...Object.fromEntries(form()), staffIds: ["staff"] });
    const { staffIds, productMode, ...data } = values;
    const existing = { ...data, id: newServiceIdentity(shopId, key), variantId: "gid://shopify/ProductVariant/123", active: true, staff: [{ staffId: "staff" }] };
    state.db.service.findFirst.mockImplementation(async ({ where }: { where: { slug?: string; id?: string } }) => where.id === existing.id ? existing : null);
    const verify = vi.fn(), createProduct = vi.fn();
    await expect(mutateCatalog(shopId, "services", form(), verify, createProduct)).resolves.toMatchObject({ id: existing.id });
    expect(createProduct).not.toHaveBeenCalled(); expect(state.db.service.create).not.toHaveBeenCalled();
  });
  it("binds the creation key to the saved service fields", async () => {
    const values = serviceSchema.parse({ ...Object.fromEntries(form()), staffIds: ["staff"] });
    const { staffIds, productMode, ...data } = values;
    const existing = { ...data, id: newServiceIdentity(shopId, key), variantId: "gid://shopify/ProductVariant/123", active: true, staff: [{ staffId: "staff" }] };
    state.db.service.findFirst.mockImplementation(async ({ where }: { where: { slug?: string; id?: string } }) => where.id === existing.id ? existing : null);
    const verify = vi.fn(), createProduct = vi.fn();
    await expect(mutateCatalog(shopId, "services", form({ price: "30.00" }), verify, createProduct)).rejects.toThrow("already used");
    expect(createProduct).not.toHaveBeenCalled(); expect(state.db.service.update).not.toHaveBeenCalled();
  });
  it("does not create a Shopify product for a free service", async () => {
    const verify = vi.fn(), createProduct = vi.fn();
    await expect(mutateCatalog(shopId, "services", form({ price: "0.00" }), verify, createProduct)).resolves.toMatchObject({ priceCents: 0, variantId: null });
    expect(createProduct).not.toHaveBeenCalled(); expect(verify).not.toHaveBeenCalled();
  });
});

describe("default location and Availability bootstrap", () => {
  beforeEach(() => {
    state.db.shop = { findUniqueOrThrow: vi.fn().mockResolvedValue({ timezone: "Asia/Kolkata", currency: "INR", domain: "my-salon.myshopify.com", email: "owner@example.com" }) };
    state.db.location.count = vi.fn().mockResolvedValue(0);
    state.db.location.create = vi.fn().mockResolvedValue({ id: "loc", name: "Main location", timezone: "Asia/Kolkata" });
    state.db.location.findFirst = vi.fn().mockResolvedValue({ id: "loc" });
    state.db.location.findMany = vi.fn().mockResolvedValue([{ id: "loc", name: "Main location", timezone: "Asia/Kolkata" }]);
    state.db.staffMember.count = vi.fn().mockResolvedValue(0);
    state.db.staffMember.create = vi.fn().mockResolvedValue({ id: "staff" });
    state.db.staffMember.findMany = vi.fn().mockResolvedValue([{ id: "staff", timezone: "Asia/Kolkata" }]);
    state.db.availabilityRule = { createMany: vi.fn().mockResolvedValue({ count: 5 }) };
    state.db.service.findMany = vi.fn().mockResolvedValue([]);
  });
  it("creates one default location in the shop's own timezone when none exist", async () => {
    const result = await catalogData(shopId);
    expect(state.db.location.create).toHaveBeenCalledWith({ data: { name: "Main location", timezone: "Asia/Kolkata", shopId } });
    expect(result.locations).toHaveLength(1);
  });
  it("never creates a second location once one already exists", async () => {
    state.db.location.count.mockResolvedValue(1);
    await catalogData(shopId);
    expect(state.db.location.create).not.toHaveBeenCalled();
  });
  it("creates one default Availability named after the store, assigned to the new location", async () => {
    await catalogData(shopId);
    expect(state.db.staffMember.create).toHaveBeenCalledWith({ data: {
      firstName: "My Salon", lastName: "", email: "owner@example.com", timezone: "Asia/Kolkata", locationIds: ["loc"], shopId,
    } });
  });
  it("falls back to a placeholder email when the shop has none on file", async () => {
    state.db.shop.findUniqueOrThrow.mockResolvedValue({ timezone: "Asia/Kolkata", currency: "INR", domain: "my-salon.myshopify.com", email: null });
    await catalogData(shopId);
    expect(state.db.staffMember.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ email: "owner@my-salon.myshopify.com" }) }));
  });
  it("never creates a second default Availability once one already exists", async () => {
    state.db.staffMember.count.mockResolvedValue(1);
    state.db.staffMember.findMany.mockResolvedValue([]);
    await catalogData(shopId);
    expect(state.db.staffMember.create).not.toHaveBeenCalled();
    expect(state.db.availabilityRule.createMany).not.toHaveBeenCalled();
  });
  it("seeds Monday-Friday 9-5 hours for a new default Availability", async () => {
    await catalogData(shopId);
    expect(state.db.availabilityRule.createMany).toHaveBeenCalledWith({ data: [1, 2, 3, 4, 5].map(weekday => ({
      staffId: "staff", weekday, startTime: "09:00", endTime: "17:00", timezone: "Asia/Kolkata", shopId,
    })) });
  });
  it("assigns the default Availability to an existing location when one is already there", async () => {
    state.db.location.count.mockResolvedValue(1);
    await catalogData(shopId);
    expect(state.db.location.create).not.toHaveBeenCalled();
    expect(state.db.staffMember.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ locationIds: ["loc"] }) }));
  });
  it("backfills hours for a pre-existing Availability that predates this default, not just a brand-new one", async () => {
    state.db.staffMember.count.mockResolvedValue(1);
    state.db.staffMember.findMany.mockResolvedValue([{ id: "existing-staff", timezone: "America/New_York" }]);
    await catalogData(shopId);
    expect(state.db.staffMember.create).not.toHaveBeenCalled();
    expect(state.db.availabilityRule.createMany).toHaveBeenCalledWith({ data: [1, 2, 3, 4, 5].map(weekday => ({
      staffId: "existing-staff", weekday, startTime: "09:00", endTime: "17:00", timezone: "America/New_York", shopId,
    })) });
  });
});
