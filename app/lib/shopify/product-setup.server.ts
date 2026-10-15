import { createHash } from "node:crypto";
import { z } from "zod";
import { BookingError } from "../bookings/validation";
import type { AdminGraphql } from "./variant.server";

const inputSchema = z.object({
  shopId: z.string().min(1).max(100), serviceId: z.string().min(1).max(100),
  title: z.string().trim().min(1).max(160), description: z.string().max(5000).nullable().optional(),
  priceCents: z.number().int().min(1).max(999999999),
});
export type BookingProductInput = z.infer<typeof inputSchema>;
const productSchema = z.object({
  id: z.string().regex(/^gid:\/\/shopify\/Product\/\d+$/), handle: z.string(), status: z.string(),
  source: z.object({ value: z.string() }).nullable(),
  variants: z.object({
    nodes: z.array(z.object({
      id: z.string().regex(/^gid:\/\/shopify\/ProductVariant\/\d+$/), price: z.string().regex(/^\d+(?:\.\d{1,2})?$/),
      inventoryItem: z.object({ requiresShipping: z.boolean(), tracked: z.boolean() }),
    })),
    pageInfo: z.object({ hasNextPage: z.boolean() }),
  }),
});
type BookingProduct = z.infer<typeof productSchema>;
const fragment = `id handle status source: metafield(namespace: "$app:booknest", key: "service_id") { value }
  variants(first: 2) { nodes { id price inventoryItem { requiresShipping tracked } } pageInfo { hasNextPage } }`;
const userErrors = z.array(z.object({ message: z.string() }));
const publicationsSchema = z.object({ data: z.object({ publications: z.object({
  nodes: z.array(z.object({ id: z.string().regex(/^gid:\/\/shopify\/Publication\/\d+$/), channels: z.object({ nodes: z.array(z.object({ handle: z.string() })) }) })),
  pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
}) }) });
const lookupSchema = z.object({ data: z.object({ products: z.object({ nodes: z.array(productSchema) }) }) });
const createSchema = z.object({ data: z.object({ productSet: z.object({ product: productSchema.nullable(), userErrors }) }) });
const publishSchema = z.object({ data: z.object({ publishablePublish: z.object({
  publishable: z.object({ publishedOnPublication: z.boolean() }).nullable(), userErrors,
}) }) });

export function productIdentity(shopId: string, serviceId: string) {
  const marker = createHash("sha256").update(JSON.stringify([shopId, serviceId])).digest("hex");
  return { marker, handle: "booknest-" + marker };
}
export function newServiceIdentity(shopId: string, creationKey: string) {
  z.string().uuid().parse(creationKey);
  z.string().min(1).max(100).parse(shopId);
  return "bn_" + createHash("sha256").update(JSON.stringify([shopId, creationKey])).digest("hex");
}
function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]!));
}
async function graphql<T>(admin: AdminGraphql, query: string, variables: Record<string, unknown>, schema: z.ZodType<T>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new BookingError("Shopify product setup timed out. Retry this form to recover the same product.", 503)), 6000); });
    const response = await Promise.race([admin.graphql(query, { variables }), timeout]);
    const raw: unknown = await response.json();
    const parsed = schema.safeParse(raw);
    const errors = raw && typeof raw === "object" && "errors" in raw ? (raw as { errors?: unknown }).errors : undefined;
    if (!response.ok || !parsed.success || (Array.isArray(errors) && errors.length))
      throw new BookingError("Shopify could not verify product setup. Check app product and publication permissions, then retry.", 503);
    return parsed.data;
  } finally { if (timer) clearTimeout(timer); }
}
export async function onlineStorePublication(admin: AdminGraphql) {
  let after: string | null = null;
  for (let page = 0; page < 5; page++) {
    const result: z.infer<typeof publicationsSchema> = await graphql(admin, `query BookNestOnlineStorePublication($after: String) {
      publications(first: 100, after: $after, catalogType: APP) { nodes { id channels(first: 5) { nodes { handle } } } pageInfo { hasNextPage endCursor } }
    }`, { after }, publicationsSchema);
    const found = result.data.publications.nodes.filter(item => item.channels.nodes.some(channel => channel.handle === "online_store"));
    if (found.length > 1) throw new BookingError("The Online Store publication is ambiguous. Contact support before creating a product.", 409);
    if (found[0]) return found[0].id;
    if (!result.data.publications.pageInfo.hasNextPage) break;
    const cursor = result.data.publications.pageInfo.endCursor;
    if (!cursor || cursor === after) break;
    after = cursor;
  }
  throw new BookingError("Shopify's Online Store publication could not be found. Enable the Online Store sales channel, then retry.", 409);
}
async function findProduct(admin: AdminGraphql, handle: string) {
  const response = await graphql(admin, `query BookNestCreatedProduct($query: String!) { products(first: 2, query: $query) { nodes { ${fragment} } } }`,
    { query: "handle:" + handle }, lookupSchema);
  const exact = response.data.products.nodes.filter(item => item.handle === handle);
  if (exact.length > 1) throw new BookingError("Product setup returned more than one matching product. Contact support.", 409);
  return exact[0] ?? null;
}
function requireOwnedProduct(product: BookingProduct, input: BookingProductInput) {
  const identity = productIdentity(input.shopId, input.serviceId);
  if (product.handle !== identity.handle || product.source?.value !== identity.marker)
    throw new BookingError("This booking product handle belongs to another product. Choose an existing variant instead.", 409);
  if (product.status !== "ACTIVE") throw new BookingError("The previously created booking product must be active. Restore it in Shopify, then retry.", 409);
  if (product.variants.nodes.length !== 1 || product.variants.pageInfo.hasNextPage)
    throw new BookingError("The previously created booking product must have a single variant. Choose the intended existing variant instead.", 409);
  const variant = product.variants.nodes[0]!;
  const [whole, fraction = ""] = variant.price.split(".");
  if (Number(whole) * 100 + Number(fraction.padEnd(2, "0")) !== input.priceCents)
    throw new BookingError("The previously created product price changed. Match the service price or select an existing variant.", 409);
  if (variant.inventoryItem.requiresShipping || variant.inventoryItem.tracked)
    throw new BookingError("The previously created product is configured for shipping or tracked inventory. Select an existing variant instead.", 409);
  return { productId: product.id, variantId: variant.id, handle: product.handle };
}

/** Called only after authenticated merchant identity and local service references are verified.
 * A deterministic upsert handle and app-owned marker recover creation after a lost response.
 * Existing products are inspected and reused; productSet is never called on a known product.
 */
export async function createBookingProduct(admin: AdminGraphql, supplied: BookingProductInput) {
  const input = inputSchema.parse(supplied);
  // Resolve the destination before creating anything, so missing publication access is recoverable.
  const publicationId = await onlineStorePublication(admin);
  const identity = productIdentity(input.shopId, input.serviceId);
  let product = await findProduct(admin, identity.handle);
  if (!product) {
    try {
      const result = await graphql(admin, `mutation BookNestCreateBookingProduct($input: ProductSetInput!, $identifier: ProductSetIdentifiers!) {
        productSet(input: $input, identifier: $identifier, synchronous: true) { product { ${fragment} } userErrors { message } }
      }`, {
        identifier: { handle: identity.handle },
        input: {
          title: input.title, handle: identity.handle, status: "ACTIVE", productType: "BookNest appointment",
          descriptionHtml: input.description ? "<p>" + escapeHtml(input.description).replace(/\r?\n/g, "<br>") + "</p>" : "",
          metafields: [{ namespace: "$app:booknest", key: "service_id", type: "single_line_text_field", value: identity.marker }],
          productOptions: [{ name: "Title", position: 1, values: [{ name: "Default Title" }] }],
          variants: [{ optionValues: [{ optionName: "Title", name: "Default Title" }],
            price: (input.priceCents / 100).toFixed(2), published: true, inventoryPolicy: "CONTINUE",
            inventoryItem: { requiresShipping: false, tracked: false } }],
        },
      }, createSchema);
      if (result.data.productSet.userErrors.length || !result.data.productSet.product)
        throw new BookingError("Shopify could not create the booking product. " + (result.data.productSet.userErrors[0]?.message.slice(0, 500) ?? "Retry this form."), 409);
      product = result.data.productSet.product;
    } catch (error) {
      // A timeout may follow a committed Shopify mutation; never create a random replacement.
      product = await findProduct(admin, identity.handle);
      if (!product) throw error instanceof BookingError ? error : new BookingError("Shopify product creation did not finish. Retry this form to recover the same product.", 503);
    }
  }
  const output = requireOwnedProduct(product, input);
  try {
    const result = await graphql(admin, `mutation BookNestPublishBookingProduct($id: ID!, $publicationId: ID!) {
      publishablePublish(id: $id, input: { publicationId: $publicationId }) {
        publishable { publishedOnPublication(publicationId: $publicationId) } userErrors { message }
      }
    }`, { id: product.id, publicationId }, publishSchema);
    if (result.data.publishablePublish.userErrors.length || !result.data.publishablePublish.publishable?.publishedOnPublication)
      throw new Error("Product not published");
  } catch {
    throw new BookingError("The booking product was created, but Online Store publishing did not finish. Retry this form; BookNest will reuse the same product.", 503);
  }
  return output;
}
