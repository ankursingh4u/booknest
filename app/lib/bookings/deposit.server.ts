import { DateTime } from "luxon";
import { z } from "zod";
import { getShopDatabase, withShopTransaction } from "../../db.server";
import { BookingError } from "./validation";
import { reservationProperties } from "./checkout";
type Graphql = { graphql(query: string, options?: { variables?: Record<string, unknown> }): Promise<Response> };
const draftSchema = z.object({ id: z.string(), invoiceUrl: z.string().url(), tags: z.array(z.string()).optional() });
/** Store the attempt before the external mutation; uncertain retries recover by the reservation tag. */
export async function depositCheckout(shopId: string, reservationId: string, admin: Graphql) {
  const db = getShopDatabase(shopId);
  const initial = await db.reservation.findUnique({ where: { id: reservationId } });
  if (!initial) throw new BookingError("Reservation not found.", 404);
  const attempt = await withShopTransaction(shopId, async tx => {
    const hold = await tx.reservation.findUniqueOrThrow({ where: { id: reservationId } });
    if (hold.expiresAt <= DateTime.utc().toJSDate()) throw new BookingError("This reservation has expired.");
    if (hold.checkoutUrl) return { hold, create: false };
    if (hold.checkoutStartedAt) return { hold, create: false };
    await tx.reservation.update({ where: { id: hold.id }, data: { checkoutStartedAt: DateTime.utc().toJSDate() } });
    return { hold, create: true };
  }, [initial.staffId]);
  if (attempt.hold.checkoutUrl) return attempt.hold.checkoutUrl;
  const tag = "BookNest_" + reservationId;
  let draft: z.infer<typeof draftSchema>;
  if (!attempt.create) {
    const response = await admin.graphql("query RecoverBookNestCheckout($query: String!) { draftOrders(first: 10, query: $query) { nodes { id invoiceUrl tags } } }", { variables: { query: "tag:" + tag } });
    const body = z.object({ data: z.object({ draftOrders: z.object({ nodes: z.array(draftSchema) }) }) }).parse(await response.json());
    const recovered = body.data.draftOrders.nodes.find(item => item.tags?.includes(tag));
    if (!recovered) throw new BookingError("Checkout is still being prepared. Please try again shortly.");
    draft = recovered;
  } else {
    const hold = attempt.hold;
    const [service, location, staff] = await Promise.all([
      db.service.findUniqueOrThrow({ where: { id: hold.serviceId } }), db.location.findUniqueOrThrow({ where: { id: hold.locationId } }),
      db.staffMember.findUniqueOrThrow({ where: { id: hold.staffId }, select: { firstName: true, lastName: true } }),
    ]);
    const properties = reservationProperties(hold, location.timezone, staff.firstName + " " + staff.lastName);
    // Shopify 2026-07 DraftOrderLineItemInput.originalUnitPriceWithCurrency.
    const response = await admin.graphql("mutation BookNestDeposit($input: DraftOrderInput!) { draftOrderCreate(input: $input) { draftOrder { id invoiceUrl } userErrors { message field } } }", {
      variables: { input: { tags: [tag, "BookNest"], presentmentCurrencyCode: hold.currency, allowDiscountCodesInCheckout: false, acceptAutomaticDiscounts: false,
        note: "Deposit for " + service.title + ". Remaining balance: " + ((hold.priceCents - hold.dueCents) * hold.quantity / 100).toFixed(2) + " " + hold.currency + ".",
        lineItems: [{ title: "Deposit · " + service.title, quantity: hold.quantity, requiresShipping: false, taxable: true,
          originalUnitPriceWithCurrency: { amount: (hold.dueCents / 100).toFixed(2), currencyCode: hold.currency },
          customAttributes: Object.entries(properties).map(([key, value]) => ({ key, value })) }] } },
    });
    const body = z.object({ data: z.object({ draftOrderCreate: z.object({ draftOrder: draftSchema.nullable(), userErrors: z.array(z.object({ message: z.string() })) }) }) }).parse(await response.json());
    if (body.data.draftOrderCreate.userErrors.length || !body.data.draftOrderCreate.draftOrder) {
      await db.reservation.update({ where: { id: reservationId }, data: { checkoutStartedAt: null } });
      throw new BookingError("The store could not prepare deposit checkout. Please contact the store.");
    }
    draft = body.data.draftOrderCreate.draftOrder;
  }
  if (new URL(draft.invoiceUrl).protocol !== "https:") throw new BookingError("Invalid checkout address.", 502);
  await db.reservation.update({ where: { id: reservationId }, data: { checkoutId: draft.id, checkoutUrl: draft.invoiceUrl } });
  return draft.invoiceUrl;
}
