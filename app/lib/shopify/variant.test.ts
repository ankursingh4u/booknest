import { describe, expect, it, vi } from "vitest";
import { verifyBookingVariant } from "./variant.server";
const gid = "gid://shopify/ProductVariant/123";
const publicationId = "gid://shopify/Publication/11";
const publications = { data: { publications: { nodes: [{ id: publicationId, channels: { nodes: [{ handle: "online_store" }] } }], pageInfo: { hasNextPage: false, endCursor: null } } } };
const reply = (variant: unknown) => ({ graphql: vi.fn().mockImplementation(async (query: string) => Response.json(query.includes("productVariant(") ? { data: { productVariant: variant } } : publications)) });
describe("booking product validation", () => {
  it("accepts an active linked product at the configured base price", async () => {
    const admin = reply({ id: gid, price: "29.99", publishedOnPublication: true, product: { status: "ACTIVE" } });
    await expect(verifyBookingVariant(admin, gid, 2999)).resolves.toBeUndefined();
    expect(admin.graphql).toHaveBeenCalledWith(expect.any(String), { variables: { id: gid, publicationId } });
  });
  it("rejects a missing or archived product", async () => {
    await expect(verifyBookingVariant(reply(null), gid, 2999)).rejects.toThrow("active Shopify product");
    await expect(verifyBookingVariant(reply({ id: gid, price: "29.99", publishedOnPublication: true, product: { status: "ARCHIVED" } }), gid, 2999)).rejects.toThrow("active Shopify product");
  });
  it("rejects prices that have drifted from the booking price", async () => {
    await expect(verifyBookingVariant(reply({ id: gid, price: "30.00", publishedOnPublication: true, product: { status: "ACTIVE" } }), gid, 2999)).rejects.toThrow("price");
  });
  it("rejects a variant that cannot be purchased on the Online Store", async () => {
    const admin = reply({ id: gid, price: "29.99", publishedOnPublication: false, product: { status: "ACTIVE" } });
    await expect(verifyBookingVariant(admin, gid, 2999)).rejects.toThrow("Online Store");
  });
  it("fails closed when Shopify returns top-level errors alongside variant data", async () => {
    const admin = { graphql: vi.fn().mockImplementation(async (query: string) => Response.json(query.includes("productVariant(") ? { data: { productVariant: { id: gid, price: "29.99", publishedOnPublication: true, product: { status: "ACTIVE" } } }, errors: [{ message: "Partial data" }] } : publications)) };
    await expect(verifyBookingVariant(admin, gid, 2999)).rejects.toThrow();
  });
  it("fails closed on malformed Shopify responses", async () => {
    const admin = { graphql: vi.fn().mockResolvedValue(Response.json({ errors: [{ message: "unavailable" }] })) };
    await expect(verifyBookingVariant(admin, gid, 2999)).rejects.toThrow();
  });
});
