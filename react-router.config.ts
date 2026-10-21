export default {
  ssr: true,
  // Form/fetcher submissions happen inside Shopify's embedded admin iframe, so the
  // browser's Origin header on POSTs can be a Shopify host rather than our own -
  // react-router's CSRF check otherwise rejects every action with "Bad Request".
  // app.booknestapp.site is listed too because @react-router/serve doesn't set
  // Express's "trust proxy", so behind Coolify's TLS-terminating reverse proxy the
  // server sees its own request as http:// while the browser's Origin is https://,
  // an exact-match failure that falls through to this allowlist.
  allowedActionOrigins: ["app.booknestapp.site", "admin.shopify.com", "*.myshopify.com", "*.spin.dev", "admin.myshopify.io", "admin.shop.dev"],
};
