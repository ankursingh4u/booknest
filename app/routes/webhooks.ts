import type { Prisma } from "@prisma/client";
import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { findShopIdentity, getShopDatabase } from "../db.server";
export async function action({ request }: ActionFunctionArgs) {
  const { shop: domain, topic, webhookId, payload } = await authenticate.webhook(request);
  const shop = await findShopIdentity(domain);
  if (!shop) return new Response(null, { status: 200 });
  if (!webhookId) return new Response("Missing event identifier.", { status: 400 });
  const supported = ["ORDERS_CREATE", "ORDERS_PAID", "ORDERS_CANCELLED", "REFUNDS_CREATE", "APP_UNINSTALLED", "CUSTOMERS_DATA_REQUEST", "CUSTOMERS_REDACT", "SHOP_REDACT"];
  if (!supported.includes(String(topic))) return new Response("Unsupported topic.", { status: 400 });
  await getShopDatabase(shop.id).webhookReceipt.upsert({
    where: { shopId_externalId: { shopId: shop.id, externalId: webhookId } },
    create: { shopId: shop.id, externalId: webhookId, topic: String(topic), payload: payload as Prisma.InputJsonObject },
    update: {},
  });
  // The durable receipt is the outbox. The worker enqueues it even after a web process crash.
  return new Response(null, { status: 200 });
}
