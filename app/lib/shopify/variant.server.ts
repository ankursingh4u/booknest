import { z } from "zod";
import { onlineStorePublication } from "./product-setup.server";
import { BookingError } from "../bookings/validation";
export type AdminGraphql = { graphql(query: string, options?: { variables?: Record<string, unknown> }): Promise<Response> };
const payload = z.object({ data: z.object({ productVariant: z.object({
  id: z.string(), publishedOnPublication: z.boolean(), price: z.string().regex(/^\d+(?:\.\d{1,2})?$/), product: z.object({ status: z.string() }),
}).nullable() }) });
export async function verifyBookingVariant(admin: AdminGraphql, variantId: string, expectedCents: number) {
  const publicationId = await onlineStorePublication(admin);
  const response = await admin.graphql("query BookNestVariant($id: ID!, $publicationId: ID!) { productVariant(id: $id) { id price publishedOnPublication(publicationId: $publicationId) product { status } } }", { variables: { id: variantId, publicationId } });
  const raw: unknown = await response.json();
  const parsed = payload.safeParse(raw);
  const errors = raw && typeof raw === "object" && "errors" in raw ? (raw as { errors?: unknown }).errors : undefined;
  if (!response.ok || !parsed.success || (Array.isArray(errors) && errors.length)) throw new BookingError("The store could not verify the booking product. Please try again.", 503);
  const variant = parsed.data.data.productVariant;
  if (!variant || variant.id !== variantId || variant.product.status !== "ACTIVE") throw new BookingError("Link an active Shopify product before accepting paid bookings.", 409);
  if (!variant.publishedOnPublication) throw new BookingError("Publish this Shopify product variant to the Online Store before accepting paid bookings.", 409);
  const [whole, fraction = ""] = variant.price.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents !== expectedCents) throw new BookingError("The Shopify product price and Event/Service price differ. Update the Event/Service before booking.", 409);
}
const handlePayload = z.object({ data: z.object({ productVariant: z.object({ product: z.object({ handle: z.string() }) }).nullable() }) });
export async function productHandleForVariant(admin: AdminGraphql, variantId: string): Promise<string | null> {
  const response = await admin.graphql("query BookNestProductHandle($id: ID!) { productVariant(id: $id) { product { handle } } }", { variables: { id: variantId } });
  const raw: unknown = await response.json();
  const parsed = handlePayload.safeParse(raw);
  const errors = raw && typeof raw === "object" && "errors" in raw ? (raw as { errors?: unknown }).errors : undefined;
  if (!response.ok || !parsed.success || (Array.isArray(errors) && errors.length) || !parsed.data.data.productVariant) return null;
  return parsed.data.data.productVariant.product.handle;
}
