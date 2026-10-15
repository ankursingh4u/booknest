import { z } from "zod";

const environmentSchema = z.object({
  SHOPIFY_API_KEY: z.string().trim().min(1),
  SHOPIFY_API_SECRET: z.string().trim().min(1),
  SHOPIFY_APP_URL: z.string().url().refine((value) => {
    let url: URL;
    try { url = new URL(value); } catch { return false; }
    return !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash
      && (url.protocol === "https:" || url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname));
  }),
  SCOPES: z.string().trim().min(1),
});

export function readShopifyConfig(environment: Record<string, string | undefined> = process.env) {
  const parsed = environmentSchema.safeParse(environment);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((issue) => issue.path.join(".")))];
    throw new Error("Invalid Shopify configuration: " + fields.join(", "));
  }
  const scopes = parsed.data.SCOPES.split(",").map((scope) => scope.trim()).filter(Boolean);
  if (!scopes.length) throw new Error("Invalid Shopify configuration: SCOPES");
  return {
    apiKey: parsed.data.SHOPIFY_API_KEY,
    apiSecretKey: parsed.data.SHOPIFY_API_SECRET,
    appUrl: new URL(parsed.data.SHOPIFY_APP_URL).origin,
    scopes,
    apiVersion: "2026-07" as const,
  };
}
