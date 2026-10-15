import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import path from "node:path";
const fileState = vi.hoisted(() => ({ files: new Map<string, Buffer | string>(), writes: new Map<string, string>() }));
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(async (filename: string, encoding?: string) => {
    const value = fileState.files.get(filename.replaceAll("\\", "/"));
    if (value === undefined) throw Object.assign(new Error("Missing fixture"), { code: "ENOENT" });
    return encoding ? String(value) : Buffer.from(value);
  }),
  writeFile: vi.fn(async (filename: string, value: string) => { fileState.writes.set(filename.replaceAll("\\", "/"), String(value)); }),
}));
// The deployment CLI is native JavaScript and deliberately has no TypeScript dependency.
// @ts-expect-error Native .mjs entry point has no declaration file.
import { assertApplication, assertDatabase, deployCoolify, loadRelease, runtimeEnvironment, validateTarget } from "../scripts/deploy-coolify.mjs";
const fixtureRoot = path.resolve("C:/fixture-booknest").replaceAll("\\", "/");
const archive = Buffer.from("fixture-source-archive");
const sha256 = createHash("sha256").update(archive).digest("hex");
const env = {
  COOLIFY_API_URL: "https://coolify.example.com", COOLIFY_API_TOKEN: "fixture-coolify-token-never-log",
  COOLIFY_PROJECT_UUID: "project-12345678", COOLIFY_ENVIRONMENT_UUID: "environment-12345678",
  COOLIFY_SERVER_UUID: "server-12345678", COOLIFY_DATABASE_UUID: "database-12345678",
  SHOPIFY_API_KEY: "fixture-shopify-id", SHOPIFY_API_SECRET: "fixture-shopify-secret-never-log",
  SHOPIFY_APP_URL: "https://app.booknestapp.site", SESSION_SECRET: "fixture-session-secret-at-least-thirty-two-characters",
  SCOPES: "read_products,write_products,read_publications,write_publications",
};
const target = validateTarget(env);
const appUUID = "created-app-12345678", deploymentUUID = "deployment-12345678";
const database = () => ({
  uuid: env.COOLIFY_DATABASE_UUID, name: "booknest-db", postgres_db: "booknest",
  internal_db_url: "postgresql://booknest:fixture-database-password@database:5432/booknest", status: "running:healthy",
  environment: { uuid: env.COOLIFY_ENVIRONMENT_UUID, project: { uuid: env.COOLIFY_PROJECT_UUID } },
  destination: { id: 7, uuid: "destination-12345678", server: { uuid: env.COOLIFY_SERVER_UUID } },
});
const application = () => ({
  uuid: appUUID, name: "booknest", fqdn: env.SHOPIFY_APP_URL, description: "BookNest source SHA256: " + sha256,
  environment: { uuid: env.COOLIFY_ENVIRONMENT_UUID, project: { uuid: env.COOLIFY_PROJECT_UUID } },
  destination: { uuid: "destination-12345678", server: { uuid: env.COOLIFY_SERVER_UUID } },
});
beforeEach(() => {
  fileState.files.clear(); fileState.writes.clear();
  fileState.files.set(fixtureRoot + "/.cache/deployment/manifest.json", JSON.stringify({ sha256, files: [] }));
  fileState.files.set(fixtureRoot + "/.cache/deployment/booknest-source.tar.gz", archive);
  fileState.files.set(fixtureRoot + "/Dockerfile", "FROM node:22 AS base\nWORKDIR /app\nFROM base AS deps\nCOPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./\nFROM deps AS builder\nCOPY . .\nRUN npm run build\n");
});
type RecordedRequest = { pathname: string; options: RequestInit };
type ScenarioOptions = {
  listed?: unknown[]; database?: Record<string, unknown>; returnedApp?: Record<string, unknown>; created?: Record<string, unknown>; deployments?: unknown[]; environmentApplications?: unknown[]; status?: string;
};
function scenario(options: ScenarioOptions = {}) {
  const calls: RecordedRequest[] = [];
  let created = false;
  const request = vi.fn(async (url: string, init: RequestInit = {}) => {
    const pathname = new URL(url).pathname;
    calls.push({ pathname, options: init });
    if (pathname === "/health") return Response.json({ status: "ok", app: "booknest" });
    if (pathname === "/api/v1/version") return Response.json("4.fixture");
    if (pathname === "/api/v1/projects/" + target.project) return Response.json({ uuid: target.project, name: "booknest", environments: [{ uuid: target.environment, name: "production" }] });
    if (pathname === "/api/v1/projects/" + target.project + "/" + target.environment) return Response.json({ uuid: target.environment, name: "production", id: 9, postgresqls: [options.database ?? database()], applications: options.environmentApplications ?? ((created || options.listed?.some((item: any) => item.uuid === appUUID)) ? [options.returnedApp ?? application()] : []) });
    if (pathname === "/api/v1/databases/" + target.database) return Response.json(options.database ?? database());
    if (pathname === "/api/v1/applications") return Response.json(options.listed ?? [{ uuid: "unrelated-app-12345678", name: "existing-other-app", fqdn: "https://other.example.com" }]);
    if (pathname === "/api/v1/applications/dockerfile") { created = true; return Response.json(options.created ?? { uuid: appUUID }, { status: 201 }); }
    if (pathname.startsWith("/api/v1/applications/") && init.method === "GET") return Response.json(options.returnedApp ?? application());
    if (pathname === "/api/v1/applications/" + appUUID + "/envs/bulk") return Response.json([]);
    if (pathname === "/api/v1/applications/" + appUUID && init.method === "PATCH") return Response.json({ uuid: appUUID });
    if (pathname === "/api/v1/deploy") return Response.json({ deployments: options.deployments ?? [{ resource_uuid: appUUID, deployment_uuid: deploymentUUID }] });
    if (pathname.startsWith("/api/v1/deployments/")) return Response.json({ status: options.status ?? "finished", deployment_uuid: deploymentUUID });
    throw new Error("Unexpected mock endpoint");
  });
  return { calls, request };
}
function settings(request: typeof fetch) {
  return { execute: true, root: fixtureRoot, request, pause: async () => undefined, log: vi.fn() };
}
describe("Coolify deployment target isolation", () => {
  it("rejects insecure transport and another public application domain", () => {
    expect(() => validateTarget({ ...env, COOLIFY_API_URL: "http://coolify.example.com" })).toThrow("HTTPS");
    expect(() => validateTarget({ ...env, SHOPIFY_APP_URL: "https://other.example.com" })).toThrow("scoped");
    expect(() => validateTarget({ ...env, COOLIFY_API_URL: "https://user:password@coolify.example.com" })).toThrow("trusted");
  });
  it("rejects a database from another project or server", () => {
    expect(() => assertDatabase({ ...database(), environment: { uuid: target.environment, project: { uuid: "foreign-project" } } }, target)).toThrow("isolated");
    expect(() => assertDatabase({ ...database(), destination: { server: { uuid: "foreign-server" } } }, target)).toThrow("isolated");
  });
  it("rejects a matching name with foreign environment or extra domains", () => {
    expect(() => assertApplication({ ...application(), environment: { uuid: "foreign-environment" } }, target)).toThrow("isolated");
    expect(() => assertApplication({ ...application(), fqdn: target.origin + ",https://other.example.com" }, target)).toThrow("domains");
  });
  it("never copies Coolify or unknown credentials into the application runtime environment", () => {
    const rows = runtimeEnvironment({ ...env, UNRELATED_PRIVATE_KEY: "private fixture" }, database().internal_db_url);
    const keys = rows.map((row: { key: string }) => row.key);
    expect(keys).not.toContain("COOLIFY_API_TOKEN"); expect(keys).not.toContain("UNRELATED_PRIVATE_KEY");
    expect(rows.every((row: { is_runtime: boolean; is_buildtime: boolean }) => row.is_runtime && !row.is_buildtime)).toBe(true);
  });
  it("fails before any mutation when the isolated database check fails", async () => {
    const mock = scenario({ database: { ...database(), name: "another-db" } });
    await expect(deployCoolify(env, settings(mock.request as typeof fetch))).rejects.toThrow("isolated");
    expect(mock.calls.every(call => call.options.method === "GET")).toBe(true);
  });
  it("fails before any mutation when an existing matching application belongs to a different project", async () => {
    const mock = scenario({ listed: [{ uuid: appUUID, name: "booknest", fqdn: target.origin }], returnedApp: { ...application(), environment: { uuid: target.environment, project: { uuid: "foreign-project" } } } });
    await expect(deployCoolify(env, settings(mock.request as typeof fetch))).rejects.toThrow("isolated");
    expect(mock.calls.every(call => call.options.method === "GET")).toBe(true);
  });
  it("supports flat application API responses only with separately verified environment membership", async () => {
    const flat = { ...application(), environment: undefined, destination: undefined, environment_id: 9, destination_id: 7 };
    const mock = scenario({ listed: [{ uuid: appUUID, name: "booknest", fqdn: target.origin }], returnedApp: flat, environmentApplications: [flat] });
    await expect(deployCoolify(env, settings(mock.request as typeof fetch))).resolves.toMatchObject({ applicationUUID: appUUID, state: "deployed-health-verified" });
  });
  it("rejects a flat app not listed in the target environment before any mutation", async () => {
    const flat = { ...application(), environment: undefined, destination: undefined, environment_id: 9, destination_id: 7 };
    const mock = scenario({ listed: [{ uuid: appUUID, name: "booknest", fqdn: target.origin }], returnedApp: flat, environmentApplications: [] });
    await expect(deployCoolify(env, settings(mock.request as typeof fetch))).rejects.toThrow();
    expect(mock.calls.every(call => call.options.method === "GET")).toBe(true);
  });
  it("does not overwrite an existing BookNest application with a different source hash", async () => {
    const mock = scenario({ listed: [{ uuid: appUUID, name: "booknest", fqdn: target.origin }], returnedApp: { ...application(), description: "older release" } });
    await expect(deployCoolify(env, settings(mock.request as typeof fetch))).rejects.toThrow("different source");
    expect(mock.calls.every(call => call.options.method === "GET")).toBe(true);
  });
});
describe("Coolify deployment transport and returned identity", () => {
  it("records and uses the created application UUID while leaving unrelated applications untouched", async () => {
    const mock = scenario(), options = settings(mock.request as typeof fetch);
    const result = await deployCoolify(env, options);
    expect(result).toMatchObject({ applicationUUID: appUUID, deploymentUUID, state: "deployed-health-verified" });
    const creation = mock.calls.find(call => call.pathname === "/api/v1/applications/dockerfile")!;
    const payload = JSON.parse(String(creation.options.body));
    expect(payload).toMatchObject({ project_uuid: target.project, environment_uuid: target.environment, server_uuid: target.server, name: "booknest", domains: target.origin, force_domain_override: false, instant_deploy: false });
    expect(Buffer.from(payload.dockerfile, "base64").toString()).toContain("# BookNest source SHA256: " + sha256);
    expect(mock.calls.filter(call => call.options.method !== "GET").every(call => !call.pathname.includes("unrelated-app"))).toBe(true);
    const saved = JSON.parse(fileState.writes.get(fixtureRoot + "/.cache/deployment/coolify-application.json")!);
    expect(saved.applicationUUID).toBe(appUUID);
    const printed = JSON.stringify(options.log.mock.calls);
    expect(printed).not.toContain(env.COOLIFY_API_TOKEN); expect(printed).not.toContain(env.SHOPIFY_API_SECRET);
    expect(printed).not.toContain(database().internal_db_url);
    const health = mock.calls.find(call => call.pathname === "/health")!;
    expect(health.options.headers).toBeUndefined();
    expect(mock.calls.every(call => call.options.redirect === "error")).toBe(true);
  });
  it("suppresses transport messages containing secrets and does not follow credential-bearing redirects", async () => {
    const request = vi.fn().mockRejectedValue(Object.assign(new Error(env.COOLIFY_API_TOKEN), { cause: { code: "EACCES" } }));
    const error = await deployCoolify(env, settings(request as typeof fetch)).catch((value: Error) => value);
    expect(error.message).toContain("EACCES"); expect(error.message).not.toContain(env.COOLIFY_API_TOKEN);
    expect(request.mock.calls[0]?.[1].redirect).toBe("error");
  });
  it("suppresses server response bodies containing runtime secrets", async () => {
    const request = vi.fn().mockResolvedValue(new Response(env.SHOPIFY_API_SECRET, { status: 401 }));
    const error = await deployCoolify(env, settings(request as typeof fetch)).catch((value: Error) => value);
    expect(error.message).toContain("HTTP 401"); expect(error.message).not.toContain(env.SHOPIFY_API_SECRET);
  });
  it("stops monitoring immediately when Coolify reports cancelled-by-user", async () => {
    const mock = scenario({ status: "cancelled-by-user" });
    await expect(deployCoolify(env, settings(mock.request as typeof fetch))).rejects.toThrow("cancelled");
    expect(mock.calls.filter(call => call.pathname.startsWith("/api/v1/deployments/"))).toHaveLength(1);
    expect(mock.calls.some(call => call.pathname === "/health")).toBe(false);
  });
  it("rejects malformed created application UUIDs before interpolating them into subsequent requests", async () => {
    const mock = scenario({ created: { uuid: "../unrelated-app" } });
    await expect(deployCoolify(env, settings(mock.request as typeof fetch))).rejects.toThrow("UUID");
    expect(mock.calls.some(call => call.pathname.endsWith("/unrelated-app"))).toBe(false);
    expect(fileState.writes.has(fixtureRoot + "/.cache/deployment/coolify-application.json")).toBe(false);
  });
  it("requires the fetched application identity to match the UUID returned by creation", async () => {
    const mock = scenario({ returnedApp: { ...application(), uuid: "different-app-12345678" } });
    await expect(deployCoolify(env, settings(mock.request as typeof fetch))).rejects.toThrow("UUID");
    expect(mock.calls.some(call => call.options.method === "PATCH")).toBe(false);
  });
  it("rejects a lone deployment response explicitly belonging to a different application", async () => {
    const mock = scenario({ deployments: [{ resource_uuid: "unrelated-app-12345678", deployment_uuid: "foreign-deployment-12345678" }] });
    await expect(deployCoolify(env, settings(mock.request as typeof fetch))).rejects.toThrow("deployment");
    expect(mock.calls.some(call => call.pathname.includes("foreign-deployment"))).toBe(false);
    expect(fileState.writes.has(fixtureRoot + "/.cache/deployment/coolify-deployment.json")).toBe(false);
  });
});

describe("standalone Coolify source transport", () => {
  it("splits a large source archive into commands below the Linux argument limit", async () => {
    const largeArchive = Buffer.alloc(180000, 8);
    const largeDigest = createHash("sha256").update(largeArchive).digest("hex");
    fileState.files.set(fixtureRoot + "/.cache/deployment/booknest-source.tar.gz", largeArchive);
    fileState.files.set(fixtureRoot + "/.cache/deployment/manifest.json", JSON.stringify({ sha256: largeDigest, files: [] }));
    const release = await loadRelease(fixtureRoot);
    const commands = String(release.dockerfile).split("\n").filter(line => line.startsWith("RUN "));
    expect(commands.every(command => Buffer.byteLength(command) < 65536)).toBe(true);
    expect(release.dockerfile).toContain("tar -xzf");
    expect(release.sha256).toBe(largeDigest);
  });
});
