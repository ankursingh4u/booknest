import type { ReactNode } from "react";
import { createRequire } from "node:module";
import { PassThrough, Readable, type Writable } from "node:stream";
import { ServerRouter } from "react-router";
import type { EntryContext } from "react-router";
import { addDocumentResponseHeaders } from "./shopify.server";

// Keep the Node renderer interface local; React owns the generated HTML.
type RenderStream = { pipe(destination: Writable): Writable; abort(): void };
const { renderToPipeableStream } = createRequire(import.meta.url)("react-dom/server") as {
  renderToPipeableStream(element: ReactNode, options: {
    onShellReady(): void;
    onShellError(error: unknown): void;
    onError(error: unknown): void;
  }): RenderStream;
};
export const streamTimeout = 10000;

export default function handleRequest(request: Request, responseStatusCode: number, responseHeaders: Headers, context: EntryContext) {
  addDocumentResponseHeaders(request, responseHeaders);
  responseHeaders.set("Content-Type", "text/html; charset=utf-8");

  return new Promise<Response>((resolve, reject) => {
    const body = new PassThrough();
    let renderStream: RenderStream | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    function cleanup() {
      if (timeout) clearTimeout(timeout);
      request.signal.removeEventListener("abort", cancel);
    }
    function cancel() {
      const error = new DOMException("Document request was cancelled", "AbortError");
      renderStream?.abort();
      body.destroy(error);
      cleanup();
      reject(error);
    }
    body.once("close", cleanup);
    body.once("error", cleanup);
    if (request.signal.aborted) { cancel(); return; }
    request.signal.addEventListener("abort", cancel, { once: true });

    renderStream = renderToPipeableStream(<ServerRouter context={context} url={request.url} />, {
      onShellReady() {
        // React emits the doctype and continues streaming Router's loader data.
        resolve(new Response(Readable.toWeb(body) as ReadableStream<Uint8Array>, {
          status: responseStatusCode, headers: responseHeaders,
        }));
        renderStream!.pipe(body);
      },
      onShellError(error) {
        cleanup();
        body.destroy();
        reject(error);
      },
      onError() {
        responseStatusCode = 500;
        if (!request.signal.aborted) console.error("BookNest document rendering failed");
      },
    });
    // Router gets time to reject unresolved loader promises before React aborts.
    timeout = setTimeout(() => renderStream?.abort(), streamTimeout + 1000);
    timeout.unref();
  });
}
