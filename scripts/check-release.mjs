import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const checks = [];
function check(name, ready, detail) { checks.push({ check: name, status: ready ? "READY" : "BLOCKED", detail: ready ? undefined : detail }); }
for (const name of ["@react-router/dev", "@react-router/serve", "vite"]) check("Build dependency: " + name, existsSync(root + "node_modules/" + name + "/package.json"), "Install dependencies and regenerate pnpm-lock.yaml.");
check("Server build", existsSync(root + "build/server/index.js"), "Run pnpm build after installation.");
for (const key of ["SHOPIFY_API_KEY", "SHOPIFY_API_SECRET", "SHOPIFY_APP_URL", "DATABASE_URL", "DIRECT_URL", "RESEND_API_KEY", "EMAIL_FROM", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI"]) check(key, Boolean(process.env[key]), "Set this runtime environment variable.");
check("SESSION_SECRET", (process.env.SESSION_SECRET?.length ?? 0) >= 32, "Use a secret with at least 32 characters.");
check("HTTPS app origin", /^https:\/\//.test(process.env.SHOPIFY_APP_URL ?? ""), "Configure the production HTTPS origin.");
check("Partner billing", Boolean(process.env.SHOPIFY_PARTNER_ORG_ID && process.env.SHOPIFY_PARTNER_API_TOKEN), "Configure Partner API access and hosted plans.");
check("Plan enforcement", process.env.BILLING_ENFORCEMENT === "true", "Enable after validating every plan on a development store.");
check("Team seat billing", process.env.TEAM_SEAT_BILLING_ENABLED === "true" && Boolean(process.env.SHOPIFY_TEAM_SEAT_METER_HANDLE), "Validate the $8 monthly meter and enable seat billing.");
check("AI provider", Boolean(process.env.ANTHROPIC_API_KEY), "Metrics summaries work; AI summaries require the provider key.");
const manifest = JSON.parse(readFileSync(root + "package.json", "utf8"));
check("Pinned Shopify API", readFileSync(root + "shopify.app.toml", "utf8").includes('api_version = "2026-07"'), "Keep the agreed Admin API version.");
console.log(JSON.stringify({ app: manifest.name, checks, externalVerification: [
  "Regenerate and commit the lockfile, then restore frozen-lockfile installation.",
  "Apply migrations only to the isolated BookNest database.",
  "Run the two PostgreSQL concurrency tests against booknest_test.",
  "Verify OAuth, webhooks, checkout/deposit, email, calendar, and billing on the development store.",
  "Verify keyboard access and layouts at 480, 768, 1024, and 1280 pixels.",
] }, null, 2));
if (checks.some(check => check.status === "BLOCKED")) process.exitCode = 1;
