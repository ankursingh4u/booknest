export default {
  ssr: true,
  // Form/fetcher submissions happen inside Shopify's embedded admin iframe, so the
  // browser's Origin header on POSTs can be a Shopify host rather than our own -
  // react-router's CSRF check otherwise rejects every action with "Bad Request".
  allowedActionOrigins: ["admin.shopify.com", "*.myshopify.com", "*.spin.dev", "admin.myshopify.io", "admin.shop.dev"],
};
