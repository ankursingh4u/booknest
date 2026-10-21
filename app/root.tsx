import type { LinksFunction } from "react-router";
import { Links, Meta, Outlet, Scripts, ScrollRestoration, useNavigation, useRouteError, isRouteErrorResponse } from "react-router";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import styles from "./styles/app.css?url";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: polarisStyles },
  { rel: "stylesheet", href: styles },
];

export default function Root() {
  const navigation = useNavigation();
  return <html lang="en"><head>
    <meta charSet="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
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
