import { z } from "zod";

/** Deep links a merchant straight into the theme editor with the booking block queued to add. */
export function themeEditorUrl(domain: string, apiKey: string, productHandle: string) {
  z.string().regex(/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/).parse(domain);
  z.string().regex(/^[0-9a-f]{32}$/).parse(apiKey);
  z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(255).parse(productHandle);
  // No `template` param. Live behaviour (verified in the theme editor 2026-10-24): `previewPath`
  // alone opens the product template already scoped to THIS product and the block is added to its
  // main section. Adding `template=product` makes the editor ignore previewPath and preview an
  // arbitrary product instead. previewPath is not in Shopify's documented deep-link params, but it
  // is what actually works here — trust the observed behaviour over the docs.
  const params = new URLSearchParams({
    previewPath: "/products/" + productHandle, addAppBlockId: apiKey + "/booking", target: "mainSection",
  });
  return "https://admin.shopify.com/store/" + domain.replace(".myshopify.com", "") + "/themes/current/editor?" + params.toString();
}
