import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";
export default defineConfig({
  plugins: [reactRouter()],
  server: { host: "0.0.0.0", port: Number(process.env.PORT ?? 3000) },
  build: { assetsInlineLimit: 0 },
});
