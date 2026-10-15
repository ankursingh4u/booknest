import { syncShopProfile } from "./lib/shopify/profile.server";
import "@shopify/shopify-app-react-router/adapters/node";
import { ApiVersion, AppDistribution, shopifyApp } from "@shopify/shopify-app-react-router/server";
import { getSessionStorage, syncShopIdentity } from "./db.server";
import { readShopifyConfig } from "./lib/shopify/config.server";

export const shopifyConfig = readShopifyConfig();
const shopify = shopifyApp({
  apiKey: shopifyConfig.apiKey,
  apiSecretKey: shopifyConfig.apiSecretKey,
  appUrl: shopifyConfig.appUrl,
  scopes: shopifyConfig.scopes,
  apiVersion: ApiVersion.July26,
  authPathPrefix: "/auth",
  distribution: AppDistribution.AppStore,
  sessionStorage: getSessionStorage(),
  hooks: { afterAuth: async ({ session, admin }) => { const identity = await syncShopIdentity(session); if (identity) await syncShopProfile(identity.id, admin); } },
});

export default shopify;
export const authenticate = shopify.authenticate;
export const login = shopify.login;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;

export const unauthenticated = shopify.unauthenticated;
