import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile, readdir, lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = await realpath(fileURLToPath(new URL("../", import.meta.url)));
const output = path.join(root, ".cache", "deployment");
await mkdir(output, { recursive: true });
const resolvedOutput = await realpath(output);
if (!resolvedOutput.startsWith(root + path.sep)) throw new Error("Release output must stay within the workspace.");

const files = [];
const excluded = new Set(["node_modules", ".git", ".cache", ".claude", ".aws", ".codex", ".agents"]);
async function add(relative) {
  if (/[\r\n\0]/.test(relative)) throw new Error("Unsupported source filename.");
  const absolute = path.join(root, relative);
  const info = await lstat(absolute).catch(error => error.code === "ENOENT" ? null : Promise.reject(error));
  if (!info || info.isSymbolicLink()) return;
  if (info.isDirectory()) {
    for (const entry of await readdir(absolute, { withFileTypes: true })) {
      if (excluded.has(entry.name) || entry.name.startsWith(".env") || /\.(?:pem|key|p12|pfx)$/i.test(entry.name)) continue;
      await add(path.join(relative, entry.name));
    }
  } else if (info.isFile()) files.push(relative.split(path.sep).join("/"));
}
for (const relative of [
  "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.json", "vitest.config.ts",
  "vite.config.ts", "react-router.config.ts", "Dockerfile", ".dockerignore", ".env.example",
  "shopify.app.toml", "shopify.web.toml", "README.md", "CLAUDE.md", "BOOKNEST_BUILD_GUIDE.md",
  "app", "extensions", "prisma", "scripts", "tests", "docs/decisions",
]) await add(relative);
files.sort();

// Refuse to package any runtime credential copied into a source file.
const localEnv = await readFile(path.join(root, ".env"), "utf8").catch(error => error.code === "ENOENT" ? "" : Promise.reject(error));
const secrets = localEnv.split(/\r?\n/).flatMap(line => {
  const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
  if (!match || match[1] === "SHOPIFY_API_KEY" || !/(?:SECRET|TOKEN|PASSWORD|API_KEY|DATABASE_URL|DIRECT_URL)/.test(match[1])) return [];
  const value = match[2].replace(/^(['"])(.*)\1$/, "$2");
  return value.length >= 12 ? [value] : [];
});
const entries = [];
for (const file of files) {
  const content = await readFile(path.join(root, file));
  if (secrets.some(secret => content.includes(Buffer.from(secret)))) throw new Error("A runtime credential appears in source: " + file);
  entries.push({ path: file, bytes: content.length, sha256: createHash("sha256").update(content).digest("hex") });
}
const listPath = path.join(output, "source-files.txt");
await writeFile(listPath, files.join("\n") + "\n", "utf8");
const archive = path.join(output, "booknest-source.tar.gz");
const tar = process.platform === "win32" ? path.join(process.env.SystemRoot || "C:/Windows", "System32", "tar.exe") : "tar";
execFileSync(tar, ["-czf", archive, "--no-recursion", "-T", listPath], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
const contents = execFileSync(tar, ["-tzf", archive], { cwd: root, encoding: "utf8" }).trim().split(/\r?\n/);
if (contents.length !== files.length || contents.some(file => /(?:^|\/)\.env(?:$|\.)/.test(file) && file !== ".env.example")) throw new Error("Archive verification failed.");
const digest = createHash("sha256").update(await readFile(archive)).digest("hex");
await writeFile(path.join(output, "manifest.json"), JSON.stringify({ artifact: "booknest-source.tar.gz", sha256: digest, files: entries,
  state: "Source package only; dependency installation, build, live migrations and acceptance checks remain required." }, null, 2) + "\n");
console.log(JSON.stringify({ archive, manifest: path.join(output, "manifest.json"), files: files.length, sha256: digest,
  includesRuntimeSecrets: false, productionBuildIncluded: false }, null, 2));
