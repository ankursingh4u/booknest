import { z } from "zod";

/** Deep links a merchant straight into the theme editor with the booking block queued to add. */
export function themeEditorUrl(domain: string, apiKey: string, productHandle: string) {
  z.string().regex(/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/).parse(domain);
  z.string().regex(/^[0-9a-f]{32}$/).parse(apiKey);
  z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(255).parse(productHandle);
  // `template=product` is the documented param that attaches the block to the PRODUCT template's
  // main section; omitting it makes Shopify default to the homepage (index.json) template, so the
  // block lands in the wrong place. `previewPath` is a best-effort hint to preview this specific
  // product — Shopify may still show its own default preview product, but the block is correctly
  // placed on the product template and so renders on every linked product.
  const params = new URLSearchParams({
    template: "product", previewPath: "/products/" + productHandle, addAppBlockId: apiKey + "/booking", target: "mainSection",
  });
  return "https://admin.shopify.com/store/" + domain.replace(".myshopify.com", "") + "/themes/current/editor?" + params.toString();
}
