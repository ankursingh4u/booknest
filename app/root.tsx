import type { HeadersFunction, LinksFunction, LoaderFunctionArgs } from "react-router";
import { Links, Meta, Outlet, Scripts, ScrollRestoration, useLoaderData, useNavigation, useRouteError, isRouteErrorResponse } from "react-router";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import styles from "./styles/app.css?url";
import { shopifyConfig } from "./shopify.server";
import { appBridgeApiKey } from "./lib/shopify/app-bridge";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: polarisStyles },
  { rel: "stylesheet", href: styles },
];

export async function loader({ request }: LoaderFunctionArgs) {
  return { apiKey: appBridgeApiKey(new URL(request.url).pathname, shopifyConfig.apiKey) };
}

// entry.server.tsx's no-store only covers the initial HTML document - every client-side
// navigation and fetcher call goes through a .data request that bypasses that handler
// entirely, so it had no Cache-Control at all and could be served stale from the browser's
// own cache. This runs for every route response (document or .data), fixing both.
export const headers: HeadersFunction = () => ({ "Cache-Control": "no-store" });

export default function Root() {
  const navigation = useNavigation();
  const { apiKey } = useLoaderData<typeof loader>();
  return <html lang="en"><head>
    <meta charSet="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    {/* App Bridge in the head so it is present on every embedded document, including the
        session-token bounce, and can refresh the token without a manual page reload. */}
    {apiKey ? <meta name="shopify-api-key" content={apiKey} /> : null}
    {apiKey ? <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js" /> : null}
    <Meta /><Links />
  </head><body>
    <div id="booknest-admin"><Outlet /></div>
    <div className="bn-status" role="status" aria-live="polite">
      {navigation.state !== "idle" ? "Loading…" : ""}
    </div>
    <ScrollRestoration /><Scripts />
  </body></html>;
}

export function ErrorBoundary() {
  const error = useRouteError();
  const status = isRouteErrorResponse(error) ? error.status : 500;
  const message = isRouteErrorResponse(error) && status < 500 && typeof error.data === "string" ? error.data : "BookNest could not complete this request. Please try again.";
  return <html lang="en"><head><meta charSet="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><Meta /><Links /></head><body>
    <main id="booknest-admin" className="bn-login"><section className="bn-login-card"><h1>{status === 404 ? "Page not found" : "Unable to continue"}</h1><p role="alert">{message}</p><a className="bn-primary-link" href="/app">Open BookNest</a></section></main><Scripts />
  </body></html>;
}
