export default {
  ssr: true,
  // "Lazy" route discovery fetches each route's module on-demand (via /__manifest
  // plus a dynamic import) the first time a client-side navigation reaches it.
  // Inside Shopify's embedded iframe this occasionally stalls - the page shows the
  // app shell but no route content, and only a full reload (which loads routes
  // eagerly on the real document request) recovers. Loading every route up front
  // avoids that on-demand fetch entirely; the app only has ~13 routes so the extra
  // payload is small.
  routeDiscovery: { mode: "initial" },
  // Form/fetcher submissions happen inside Shopify's embedded admin iframe, so the
  // browser's Origin header on POSTs can be a Shopify host rather than our own -
  // react-router's CSRF check otherwise rejects every action with "Bad Request".
  // app.booknestapp.site is listed too because @react-router/serve doesn't set
  // Express's "trust proxy", so behind Coolify's TLS-terminating reverse proxy the
  // server sees its own request as http:// while the browser's Origin is https://,
  // an exact-match failure that falls through to this allowlist.
  allowedActionOrigins: ["app.booknestapp.site", "admin.shopify.com", "*.myshopify.com", "*.spin.dev", "admin.myshopify.io", "admin.shop.dev"],
};
