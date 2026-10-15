import { describe, expect, it, vi } from "vitest";
import { createBookingProduct, productIdentity } from "./product-setup.server";
const shop = "shop-a", serviceId = "bn_service-a", priceCents = 2999;
const input = { shopId: shop, serviceId, title: "Yoga <class>", description: "Calm & breathe\nArrive early.", priceCents };
const publicationId = "gid://shopify/Publication/11", productId = "gid://shopify/Product/22", variantId = "gid://shopify/ProductVariant/33";
const publications = { data: { publications: { nodes: [{ id: publicationId, channels: { nodes: [{ handle: "online_store" }] } }], pageInfo: { hasNextPage: false, endCursor: null } } } };
const product = (overrides: Record<string, unknown> = {}) => ({
  id: productId, handle: productIdentity(shop, serviceId).handle, status: "ACTIVE",
  source: { value: productIdentity(shop, serviceId).marker },
  variants: { nodes: [{ id: variantId, price: "29.99", inventoryItem: { requiresShipping: false, tracked: false } }], pageInfo: { hasNextPage: false } },
  ...overrides,
});
function mockedAdmin(...responses: unknown[]) {
  return { graphql: vi.fn().mockImplementation(async () => {
    const response = responses.shift(); if (response instanceof Error) throw response;
    return response instanceof Response ? response : Response.json(response);
  }) };
}
const lookup = (item: unknown) => ({ data: { products: { nodes: item == null ? [] : [item] } } });
const created = () => ({ data: { productSet: { product: product(), userErrors: [] } } });
const published = (state = true) => ({ data: { publishablePublish: { publishable: { publishedOnPublication: state }, userErrors: [] } } });
describe("merchant booking product setup", () => {
  it("creates and publishes a non-shipping, untracked single-variant product at the exact cent price", async () => {
    const admin = mockedAdmin(publications, lookup(null), created(), published());
    await expect(createBookingProduct(admin, input)).resolves.toEqual({ productId, variantId, handle: productIdentity(shop, serviceId).handle });
    const calls = admin.graphql.mock.calls;
    expect(calls[2]![1]!.variables).toMatchObject({
      identifier: { handle: productIdentity(shop, serviceId).handle },
      input: { status: "ACTIVE", title: input.title, descriptionHtml: "<p>Calm &amp; breathe<br>Arrive early.</p>",
        variants: [{ price: "29.99", inventoryPolicy: "CONTINUE", inventoryItem: { requiresShipping: false, tracked: false }, published: true }],
        metafields: [{ namespace: "$app:booknest", key: "service_id", value: productIdentity(shop, serviceId).marker }],
      },
    });
    expect(calls[3]![1]!.variables).toEqual({ id: productId, publicationId });
  });
  it("recovers an already-created owned product without repeating productSet", async () => {
    const admin = mockedAdmin(publications, lookup(product()), published());
    await expect(createBookingProduct(admin, input)).resolves.toMatchObject({ variantId });
    expect(admin.graphql.mock.calls.some(([query]) => String(query).includes("productSet("))).toBe(false);
    expect(admin.graphql).toHaveBeenCalledTimes(3);
  });
  it("recovers a timeout after Shopify created the product using the same deterministic handle", async () => {
    const admin = mockedAdmin(publications, lookup(null), new Error("request timed out"), lookup(product()), published());
    await expect(createBookingProduct(admin, input)).resolves.toMatchObject({ variantId });
    expect(admin.graphql.mock.calls.filter(([query]) => String(query).includes("productSet("))).toHaveLength(1);
  });
  it("uses different product identities for the same service ID in different stores", () => {
    expect(productIdentity("shop-a", serviceId)).not.toEqual(productIdentity("shop-b", serviceId));
  });
  it("refuses an unrelated product occupying the handle without mutating or publishing it", async () => {
    const admin = mockedAdmin(publications, lookup(product({ source: null })));
    await expect(createBookingProduct(admin, input)).rejects.toThrow("another product");
    expect(admin.graphql).toHaveBeenCalledTimes(2);
  });
  it("rejects price drift on recovery instead of overwriting merchant product changes", async () => {
    const changed = product({ variants: { nodes: [{ id: variantId, price: "30.00", inventoryItem: { requiresShipping: false, tracked: false } }], pageInfo: { hasNextPage: false } } });
    const admin = mockedAdmin(publications, lookup(changed));
    await expect(createBookingProduct(admin, input)).rejects.toThrow("price");
    expect(admin.graphql).toHaveBeenCalledTimes(2);
  });
  it("refuses to destroy extra variants added to a previously created product", async () => {
    const changed = product({ variants: { nodes: [product().variants.nodes[0], { ...product().variants.nodes[0], id: "gid://shopify/ProductVariant/44" }], pageInfo: { hasNextPage: false } } });
    const admin = mockedAdmin(publications, lookup(changed));
    await expect(createBookingProduct(admin, input)).rejects.toThrow("single");
    expect(admin.graphql).toHaveBeenCalledTimes(2);
  });
  it("rejects an archived previously-created product", async () => {
    const admin = mockedAdmin(publications, lookup(product({ status: "ARCHIVED" })));
    await expect(createBookingProduct(admin, input)).rejects.toThrow("active");
    expect(admin.graphql).toHaveBeenCalledTimes(2);
  });
  it("fails before creation when the Online Store publication cannot be located", async () => {
    const admin = mockedAdmin({ data: { publications: { nodes: [{ id: publicationId, channels: { nodes: [{ handle: "pos" }] } }], pageInfo: { hasNextPage: false, endCursor: null } } } });
    await expect(createBookingProduct(admin, input)).rejects.toThrow("Online Store");
    expect(admin.graphql).toHaveBeenCalledTimes(1);
  });
  it("matches the stable Online Store channel handle even with localized display metadata", async () => {
    const localized = { data: { publications: { nodes: [{ id: publicationId, catalog: { title: "Channel Catalog 99 für Online-Shop" }, channels: { nodes: [{ handle: "online_store" }] } }], pageInfo: { hasNextPage: false, endCursor: null } } } };
    const admin = mockedAdmin(localized, lookup(product()), published());
    await expect(createBookingProduct(admin, input)).resolves.toMatchObject({ variantId });
  });
  it("ignores a different channel even if its editable catalog title says Online Store", async () => {
    const misleading = { data: { publications: { nodes: [{ id: publicationId, catalog: { title: "Online Store" }, channels: { nodes: [{ handle: "pos" }] } }], pageInfo: { hasNextPage: false, endCursor: null } } } };
    const admin = mockedAdmin(misleading);
    await expect(createBookingProduct(admin, input)).rejects.toThrow("Online Store");
    expect(admin.graphql).toHaveBeenCalledTimes(1);
  });
  it("follows publication cursors instead of assuming the first page contains Online Store", async () => {
    const admin = mockedAdmin({ data: { publications: { nodes: [], pageInfo: { hasNextPage: true, endCursor: "page-2" } } } }, publications, lookup(product()), published());
    await expect(createBookingProduct(admin, input)).resolves.toMatchObject({ variantId });
    expect(admin.graphql.mock.calls[1]![1]!.variables).toEqual({ after: "page-2" });
  });
  it("reports a publication failure with a safe retry while retaining the same product identity", async () => {
    const admin = mockedAdmin(publications, lookup(null), created(), { data: { publishablePublish: { publishable: null, userErrors: [{ message: "Missing permissions" }] } } });
    await expect(createBookingProduct(admin, input)).rejects.toThrow("created");
    const retry = mockedAdmin(publications, lookup(product()), published());
    await expect(createBookingProduct(retry, input)).resolves.toMatchObject({ productId, variantId });
    expect(retry.graphql.mock.calls.some(([query]) => String(query).includes("productSet("))).toBe(false);
  });
  it("fails closed if Shopify returns top-level errors alongside incomplete mutation data", async () => {
    const admin = mockedAdmin(publications, lookup(null), { errors: [{ message: "Denied" }], data: { productSet: { product: null, userErrors: [] } } }, lookup(null));
    await expect(createBookingProduct(admin, input)).rejects.toThrow();
    expect(admin.graphql.mock.calls.some(([query]) => String(query).includes("publishablePublish("))).toBe(false);
  });
  it("rejects invalid prices and empty store identities without API calls", async () => {
    const admin = mockedAdmin();
    await expect(createBookingProduct(admin, { ...input, priceCents: 0 })).rejects.toThrow();
    await expect(createBookingProduct(admin, { ...input, priceCents: 12.5 })).rejects.toThrow();
    await expect(createBookingProduct(admin, { ...input, shopId: "" })).rejects.toThrow();
    expect(admin.graphql).not.toHaveBeenCalled();
  });
});
