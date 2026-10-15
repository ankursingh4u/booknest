import { z } from "zod";
import { getShopDatabase } from "../../db.server";
import { timezoneSchema } from "../admin/schemas";
type Graphql = { graphql(query: string): Promise<Response> };
export async function syncShopProfile(shopId: string, admin: Graphql) {
  const response = await admin.graphql("query BookNestStore { shop { myshopifyDomain ianaTimezone currencyCode email } }");
  const result = z.object({ data: z.object({ shop: z.object({ myshopifyDomain: z.string(), ianaTimezone: timezoneSchema, currencyCode: z.string().regex(/^[A-Z]{3}$/), email: z.string().email() }) }) }).parse(await response.json());
  const db = getShopDatabase(shopId);
  const shop = await db.shop.findUniqueOrThrow({ where: { id: shopId }, select: { domain: true } });
  if (shop.domain !== result.data.shop.myshopifyDomain) throw new Error("Store identity mismatch");
  return db.shop.update({ where: { id: shopId }, data: { timezone: result.data.shop.ianaTimezone, currency: result.data.shop.currencyCode, email: result.data.shop.email, uninstalledAt: null } });
}
