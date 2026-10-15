import { beforeEach, describe, expect, it, vi } from "vitest";
import { mutateCatalog } from "./catalog.server";
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
