import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export function validateTarget(env) {
  const required = ["COOLIFY_API_URL", "COOLIFY_API_TOKEN", "COOLIFY_PROJECT_UUID", "COOLIFY_ENVIRONMENT_UUID", "COOLIFY_SERVER_UUID", "COOLIFY_DATABASE_UUID", "SHOPIFY_API_KEY", "SHOPIFY_API_SECRET", "SHOPIFY_APP_URL", "SESSION_SECRET", "SCOPES"];
  const missing = required.filter(key => !env[key]);
  if (missing.length) throw new Error("Missing configuration: " + missing.join(", "));
  const api = new URL(env.COOLIFY_API_URL);
  const app = new URL(env.SHOPIFY_APP_URL);
  if (api.protocol !== "https:" || api.username || api.password || api.search || api.hash || !["", "/", "/api/v1", "/api/v1/"].includes(api.pathname)) throw new Error("Use a trusted HTTPS Coolify origin or /api/v1 URL.");
  if (app.origin !== "https://app.booknestapp.site" || !["", "/"].includes(app.pathname) || app.search || app.hash) throw new Error("Deployment is scoped to https://app.booknestapp.site.");
  for (const key of required.filter(key => key.endsWith("_UUID"))) if (!/^[a-zA-Z0-9-]{8,80}$/.test(env[key])) throw new Error("Invalid resource ID: " + key);
  if (env.SESSION_SECRET.length < 32) throw new Error("SESSION_SECRET must have at least 32 characters.");
  return { api: api.origin + "/api/v1", origin: app.origin, project: env.COOLIFY_PROJECT_UUID, environment: env.COOLIFY_ENVIRONMENT_UUID, server: env.COOLIFY_SERVER_UUID, database: env.COOLIFY_DATABASE_UUID };
}

function matchesEnvironment(resource, target, kind) {
  if (resource.environment && (resource.environment.uuid !== target.environment || resource.environment.project && resource.environment.project.uuid !== target.project)) return false;
  if (target.environmentResources) return target.environmentResources[kind]?.some(item => item.uuid === resource.uuid) === true;
  return resource.environment?.uuid === target.environment && resource.environment?.project?.uuid === target.project;
}
function matchesServer(resource, target) {
  if (resource.destination?.server) return resource.destination.server.uuid === target.server;
  return target.destinationId !== undefined && resource.destination_id === target.destinationId;
}
function validResourceID(value) { return typeof value === "string" && /^[a-zA-Z0-9-]{8,80}$/.test(value); }

export function assertDatabase(db, target) {
  if (db.uuid !== target.database || db.name !== "booknest-db" || db.postgres_db !== "booknest" || !matchesEnvironment(db, target, "postgresqls") || !matchesServer(db, target)) throw new Error("The database does not match the isolated BookNest target.");
  if (!db.internal_db_url) throw new Error("Coolify did not return the internal database URL; the token needs sensitive-read access.");
  const url = new URL(db.internal_db_url);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || url.pathname !== "/booknest" || !url.username || !url.password) throw new Error("BookNest internal database URL is invalid.");
}

export function assertApplication(app, target) {
  if (!validResourceID(app.uuid) || app.name !== "booknest" || !matchesEnvironment(app, target, "applications") || !matchesServer(app, target)) throw new Error("The application does not match the isolated BookNest target.");
  const domains = (app.fqdn || "").split(",").filter(Boolean).map(domain => new URL(domain).origin);
  if (domains.length !== 1 || domains[0] !== target.origin) throw new Error("The BookNest application has unexpected domains; no changes were made.");
}

export function runtimeEnvironment(env, internalDatabaseURL) {
  const allowed = ["SHOPIFY_API_KEY", "SHOPIFY_API_SECRET", "SHOPIFY_APP_URL", "SCOPES", "SESSION_SECRET", "SHOPIFY_CUSTOM_SHOP_DOMAIN", "RESEND_API_KEY", "EMAIL_FROM", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI", "ANTHROPIC_API_KEY", "ANTHROPIC_MODEL", "SHOPIFY_PARTNER_ORG_ID", "SHOPIFY_PARTNER_API_TOKEN", "SHOPIFY_PLAN_FREE_HANDLE", "SHOPIFY_PLAN_STANDARD_HANDLE", "SHOPIFY_PLAN_PRO_HANDLE", "SHOPIFY_PLAN_PRO_PLUS_HANDLE", "SHOPIFY_TEAM_SEAT_METER_HANDLE", "BILLING_ENFORCEMENT", "TEAM_SEAT_BILLING_ENABLED"];
  const values = Object.fromEntries(allowed.filter(key => env[key] !== undefined && env[key] !== "").map(key => [key, env[key]]));
  Object.assign(values, { DATABASE_URL: internalDatabaseURL, DIRECT_URL: internalDatabaseURL, NODE_ENV: "production", PORT: "3000", HOST: "0.0.0.0" });
  return Object.entries(values).map(([key, value]) => ({ key, value, is_preview: false, is_literal: true, is_runtime: true, is_buildtime: false }));
}

export async function loadRelease(root) {
  const directory = path.join(root, ".cache", "deployment");
  const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8"));
  const archive = await readFile(path.join(directory, "booknest-source.tar.gz"));
  const digest = content => createHash("sha256").update(content).digest("hex");
  if (digest(archive) !== manifest.sha256) throw new Error("Source archive checksum mismatch; regenerate the release.");
  for (const entry of manifest.files) {
    const filename = path.resolve(root, entry.path);
    if (!filename.startsWith(path.resolve(root) + path.sep) || entry.path.startsWith(".env") && entry.path !== ".env.example") throw new Error("Unsafe source manifest entry.");
    if (digest(await readFile(filename)) !== entry.sha256) throw new Error("Source changed after packaging: " + entry.path + ". Run npm run package:release.");
  }
  const encoded = archive.toString("base64");
  const chunks = encoded.match(/.{1,32768}/g) || [];
  const sourceLayer = "FROM base AS source\n" + chunks.map((chunk, index) => "RUN node -e \"require('node:fs')." + (index ? "appendFileSync" : "writeFileSync") + "('/tmp/booknest.tar.gz',Buffer.from('" + chunk + "','base64'))\"").join("\n") + "\nRUN tar -xzf /tmp/booknest.tar.gz -C /app && rm /tmp/booknest.tar.gz\n\n";
  let dockerfile = await readFile(path.join(root, "Dockerfile"), "utf8");
  const original = "FROM base AS deps\nCOPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./";
  if (!dockerfile.includes(original) || !dockerfile.includes("COPY . .")) throw new Error("Dockerfile changed; update the standalone source-layer generation.");
  dockerfile = "# BookNest source SHA256: " + manifest.sha256 + "\n" + dockerfile.replace(original, sourceLayer + "FROM base AS deps\nCOPY --from=source /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./").replace("COPY . .", "COPY --from=source /app .");
  await writeFile(path.join(directory, "Dockerfile.coolify"), dockerfile, "utf8");
  return { dockerfile, sha256: manifest.sha256, directory };
}

export async function deployCoolify(env, { execute = false, request = fetch, root = fileURLToPath(new URL("../", import.meta.url)), log = console.log, pause = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const target = validateTarget(env);
  const release = await loadRelease(root);
  if (!execute) { log(JSON.stringify({ mode: "prepared", target: target.origin, project: target.project, environment: target.environment, server: target.server, database: target.database, sourceSha256: release.sha256, dockerfile: path.join(release.directory, "Dockerfile.coolify"), runtimeSecretValuesPrinted: false })); return; }
  async function api(endpoint, method = "GET", data) {
    let response;
    try { response = await request(target.api + endpoint, { method, headers: { Authorization: "Bearer " + env.COOLIFY_API_TOKEN, Accept: "application/json", ...(data ? { "Content-Type": "application/json" } : {}) }, body: data ? JSON.stringify(data) : undefined, signal: AbortSignal.timeout(30000), redirect: "error" }); }
    catch (error) { throw new Error("Coolify connection failed at " + endpoint + " (" + (error.cause?.code || error.code || error.name) + "). No server response was received."); }
    if (!response.ok) throw new Error("Coolify " + method + " " + endpoint + " returned HTTP " + response.status + ". Response body suppressed to protect secrets.");
    const text = await response.text();
    try { return JSON.parse(text); } catch { return text; }
  }
  await api("/version");
  const [project, database, applications] = await Promise.all([api("/projects/" + target.project), api("/databases/" + target.database), api("/applications")]);
  if (project.uuid !== target.project || project.name !== "booknest" || !project.environments?.some(environment => environment.uuid === target.environment && environment.name === "production")) throw new Error("The saved BookNest project/environment no longer matches; no changes were made.");
  async function refreshEnvironment() {
    const environment = await api("/projects/" + target.project + "/" + target.environment);
    if (environment.uuid !== target.environment || environment.name !== "production" || !Array.isArray(environment.applications) || !Array.isArray(environment.postgresqls)) throw new Error("Unexpected BookNest environment membership response.");
    target.environmentResources = environment;
  }
  await refreshEnvironment();
  assertDatabase(database, target);
  if (database.destination?.id === undefined || !validResourceID(database.destination?.uuid)) throw new Error("Coolify did not return the verified BookNest Docker destination.");
  target.destinationId = database.destination.id;
  if (!Array.isArray(applications)) throw new Error("Unexpected Coolify application list.");
  const matches = applications.filter(app => app.name === "booknest" || (app.fqdn || "").split(",").some(domain => { try { return new URL(domain).origin === target.origin; } catch { return false; } }));
  if (matches.length > 1) throw new Error("More than one app matches BookNest; no changes were made.");
  const marker = "BookNest source SHA256: " + release.sha256;
  let app;
  if (matches.length) {
    if (!validResourceID(matches[0].uuid)) throw new Error("Coolify returned an invalid BookNest application UUID.");
    app = await api("/applications/" + matches[0].uuid);
    if (app.uuid !== matches[0].uuid) throw new Error("Coolify returned a different application UUID; no app changes were made.");
    assertApplication(app, target);
    if (app.description !== marker) throw new Error("An existing BookNest app uses a different source release. Update its Dockerfile in Coolify with .cache/deployment/Dockerfile.coolify and its description with " + marker + ". This API version cannot update inline Dockerfiles safely.");
  } else {
    const created = await api("/applications/dockerfile", "POST", { project_uuid: target.project, environment_uuid: target.environment, server_uuid: target.server, destination_uuid: database.destination.uuid, name: "booknest", description: marker, dockerfile: Buffer.from(release.dockerfile, "utf8").toString("base64"), domains: target.origin, ports_exposes: "3000", build_pack: "dockerfile", instant_deploy: false, is_force_https_enabled: true, connect_to_docker_network: true, force_domain_override: false, health_check_enabled: true, health_check_path: "/health", health_check_port: "3000", health_check_return_code: 200, health_check_start_period: 60 });
    if (!validResourceID(created.uuid)) throw new Error("Coolify did not return a created application UUID; inspect BookNest before retrying.");
    await writeFile(path.join(release.directory, "coolify-application.json"), JSON.stringify({ applicationUUID: created.uuid, sourceSha256: release.sha256 }) + "\n");
    app = await api("/applications/" + created.uuid);
    if (app.uuid !== created.uuid) throw new Error("Coolify returned a different application UUID; no app deployment was triggered.");
    await refreshEnvironment();
    assertApplication(app, target);
  }
  if (!String(database.status).startsWith("running:healthy")) {
    if (!String(database.status).startsWith("running")) await api("/databases/" + target.database + "/start", "POST");
    let healthy = false;
    for (let attempt = 0; attempt < 24; attempt++) { await pause(5000); const current = await api("/databases/" + target.database); assertDatabase(current, target); if (String(current.status).startsWith("running:healthy")) { healthy = true; break; } }
    if (!healthy) throw new Error("BookNest database is not healthy. App deployment was not triggered; inspect its database logs.");
  }
  await api("/applications/" + app.uuid + "/envs/bulk", "PATCH", { data: runtimeEnvironment(env, database.internal_db_url) });
  await api("/applications/" + app.uuid, "PATCH", { ports_exposes: "3000", health_check_enabled: true, health_check_path: "/health", health_check_port: "3000", health_check_return_code: 200, health_check_start_period: 60 });
  const started = await api("/deploy", "POST", { uuid: app.uuid, force: false });
  const entries = Array.isArray(started.deployments) ? started.deployments : [];
  const deployment = entries.find(item => (item.resource_uuid ?? item.uuid) === app.uuid) || (entries.length === 1 && !entries[0].resource_uuid && !entries[0].uuid ? entries[0] : undefined);
  if (!deployment || !validResourceID(deployment.deployment_uuid)) throw new Error("Coolify did not return one BookNest deployment ID. Inspect the app before retrying.");
  const record = { applicationUUID: app.uuid, deploymentUUID: deployment.deployment_uuid, sourceSha256: release.sha256, state: "queued" };
  await writeFile(path.join(release.directory, "coolify-deployment.json"), JSON.stringify(record) + "\n");
  log(JSON.stringify(record));
  for (let attempt = 0; attempt < 180; attempt++) {
    await pause(10000); const current = await api("/deployments/" + record.deploymentUUID);
    if (["failed", "cancelled", "cancelled-by-user"].includes(current.status)) throw new Error("BookNest deployment " + current.status + ". Inspect Coolify logs; deployment details were saved without secrets.");
    if (current.status === "finished") {
      const health = await request(target.origin + "/health", { signal: AbortSignal.timeout(15000), redirect: "error" });
      if (!health.ok) throw new Error("Build finished but public BookNest health returned HTTP " + health.status);
      const healthData = await health.json();
      if (healthData.status !== "ok" || healthData.app !== "booknest") throw new Error("Build finished but public BookNest health payload was unexpected.");
      record.state = "deployed-health-verified"; await writeFile(path.join(release.directory, "coolify-deployment.json"), JSON.stringify(record) + "\n");
      log(JSON.stringify({ ...record, origin: target.origin, remainingVerification: "Shopify extension/config publication and live booking/integration acceptance." })); return record;
    }
    if (attempt % 6 === 0) log(JSON.stringify({ deploymentUUID: record.deploymentUUID, status: current.status }));
  }
  throw new Error("BookNest is still deploying. Resume monitoring the saved deployment ID in Coolify; do not queue a duplicate deployment.");
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  deployCoolify(process.env, { execute: process.argv.includes("--execute") }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
