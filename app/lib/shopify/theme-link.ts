import { z } from "zod";

/** Deep links a merchant straight into the theme editor with the booking block queued to add. */
export function themeEditorUrl(domain: string, apiKey: string, productHandle: string) {
  z.string().regex(/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/).parse(domain);
  z.string().regex(/^[0-9a-f]{32}$/).parse(apiKey);
  z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(255).parse(productHandle);
  const params = new URLSearchParams({
    template: "product", addAppBlockId: apiKey + "/booking", target: "mainSection", previewPath: "/products/" + productHandle,
  });
  return "https://admin.shopify.com/store/" + domain.replace(".myshopify.com", "") + "/themes/current/editor?" + params.toString();
}
