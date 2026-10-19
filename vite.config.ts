import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";
export default defineConfig({
  plugins: [reactRouter()],
  server: { host: "0.0.0.0", port: Number(process.env.PORT ?? 3000) },
  build: { assetsInlineLimit: 0 },
  // @shopify/shopify-app-react-router's boundary.error() identifies the
  // iframe-exit error response via `error.constructor.name`, which esbuild's
  // minifier otherwise strips, breaking the embedded OAuth bounce in prod builds.
  esbuild: { keepNames: true },
});
