import { createElement } from "react";
import { createRequestHandler, Scripts, type EntryContext, type ServerBuild } from "react-router";
import { describe, expect, it, vi } from "vitest";

vi.mock("./shopify.server", () => ({ addDocumentResponseHeaders: vi.fn() }));
import handleRequest from "./entry.server";

function build(loader: () => unknown = () => ({ bookingState: "hydration-booking-state" })) {
  const Root = () => createElement("html", null,
    createElement("head"),
    createElement("body", null, createElement("h1", null, "Booking page"), createElement(Scripts)));
  return {
    assets: {
      version: "test", url: "/manifest", entry: { module: "/entry.js", imports: [] },
      routes: { root: { id: "root", path: "/", module: "/root.js", hasAction: false, hasLoader: true, hasErrorBoundary: false } },
    },
    basename: "/", entry: { module: { default: handleRequest } },
    routes: { root: { id: "root", path: "/", module: { default: Root, loader } } },
    future: {}, ssr: true, routeDiscovery: { mode: "initial" },
  } as unknown as ServerBuild;
}

describe("document rendering", () => {
  it("delivers and closes React Router's asynchronous loader-data stream", async () => {
    const response = await createRequestHandler(build(), "production")(new Request("http://localhost/"));
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/html");
    expect(html).toContain("Booking page");
    expect(html).toContain("hydration-booking-state");
    expect(html).toContain("streamController.enqueue(");
    expect(html).toContain("streamController.close(");
  });
  it("rejects a cancelled request before rendering", async () => {
    const controller = new AbortController();
    controller.abort();
    const request = new Request("http://localhost/", { signal: controller.signal });
    await expect(handleRequest(request, 200, new Headers(), {} as EntryContext)).rejects.toMatchObject({ name: "AbortError" });
  });

  it("closes a pending document stream when its request is cancelled", async () => {
    const controller = new AbortController();
    const pending = new Promise<never>(() => {});
    const response = await createRequestHandler(build(() => ({ pending })), "production")(
      new Request("http://localhost/", { signal: controller.signal }));
    const document = response.text();
    controller.abort();
    await expect(document).rejects.toMatchObject({ name: "AbortError" });
  });
});
