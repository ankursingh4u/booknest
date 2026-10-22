import { z } from "zod";

/** Deep links a merchant straight into the theme editor with the booking block queued to add. */
export function themeEditorUrl(domain: string, apiKey: string, productHandle: string) {
  z.string().regex(/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/).parse(domain);
  z.string().regex(/^[0-9a-f]{32}$/).parse(apiKey);
  z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(255).parse(productHandle);
  // No `template` param: when present, the editor picks its own default resource for that
  // template and ignores previewPath, landing the merchant on an arbitrary product.
  // previewPath alone opens the product template already scoped to this product.
  const params = new URLSearchParams({
    previewPath: "/products/" + productHandle, addAppBlockId: apiKey + "/booking", target: "mainSection",
  });
  return "https://admin.shopify.com/store/" + domain.replace(".myshopify.com", "") + "/themes/current/editor?" + params.toString();
}
