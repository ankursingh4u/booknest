import { z } from "zod";
import type { LoaderFunctionArgs } from "react-router";
import { requireShop } from "../lib/auth/admin.server";
import { productHandleForVariant } from "../lib/shopify/variant.server";
import { themeEditorUrl } from "../lib/shopify/theme-link";
import { readShopifyConfig } from "../lib/shopify/config.server";

const variantIdSchema = z.string().regex(/^gid:\/\/shopify\/ProductVariant\/\d+$/);

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, shop } = await requireShop(request);
  const variantId = variantIdSchema.parse(new URL(request.url).searchParams.get("variantId"));
  const handle = await productHandleForVariant(admin, variantId);
  if (!handle) throw new Response("Could not find the Shopify product linked to this Event/Service.", { status: 404 });
  return { url: themeEditorUrl(shop.domain, readShopifyConfig().apiKey, handle) };
}
