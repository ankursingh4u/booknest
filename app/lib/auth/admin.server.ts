import { syncBilling } from "../billing/service.server";
import { authenticate } from "../../shopify.server";
import { findShopIdentity, getShopDatabase } from "../../db.server";

export async function requireShop(request: Request) {
  const context = await authenticate.admin(request);
  const shop = await findShopIdentity(context.session.shop);
  if (!shop) throw new Response("Your store setup could not be completed. Please reopen BookNest from Shopify.", { status: 503 });
  if (process.env.BILLING_ENFORCEMENT === "true" && !["/app/billing", "/app/support"].includes(new URL(request.url).pathname)) {
    const billing = await syncBilling(shop.id, shop.domain, context.admin);
    if (billing.status !== "ACTIVE") throw context.redirect("/app/billing");
  }
  return { ...context, shop, db: getShopDatabase(shop.id) };
}
