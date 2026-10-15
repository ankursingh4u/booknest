import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const packageUrl = new URL("../node_modules/@react-router/serve/package.json", import.meta.url);
const serverPackage = JSON.parse(readFileSync(packageUrl, "utf8"));
const bin = typeof serverPackage.bin === "string" ? serverPackage.bin : serverPackage.bin?.["react-router-serve"];
if (!bin) throw new Error("React Router server executable is missing");
const children = [
  spawn(process.execPath, ["--import", "tsx", "app/worker.server.ts"], { stdio: "inherit", env: process.env }),
  spawn(process.execPath, [fileURLToPath(new URL(bin, packageUrl)), "./build/server/index.js"], { stdio: "inherit", env: process.env }),
];
let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true; process.exitCode = code;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => { for (const child of children) child.kill("SIGKILL"); }, 10000).unref();
}
for (const child of children) {
  child.on("error", () => stop(1));
  child.on("exit", code => stop(code || 1));
}
process.on("SIGTERM", () => stop(0));
process.on("SIGINT", () => stop(0));
