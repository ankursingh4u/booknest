import type { ReactNode } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, Outlet, useLoaderData, useRouteError } from "react-router";
import { AppProvider as ShopifyProvider } from "@shopify/shopify-app-react-router/react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider as PolarisProvider } from "@shopify/polaris";
import { NavMenu } from "@shopify/app-bridge-react";
import translations from "@shopify/polaris/locales/en.json";
import { requireShop } from "../lib/auth/admin.server";
import { shopifyConfig } from "../shopify.server";

// Polaris links/buttons with a `url` otherwise render a plain <a> that full-navigates the
// iframe, dropping Shopify's embedded params (shop/host/embedded/id_token) and blanking the
// app. Route them through React Router so navigation stays client-side and App Bridge keeps
// its admin-frame context. External links still open in a new tab.
function PolarisLink({ url = "", external, target, children, ...rest }:
  { url?: string; external?: boolean; target?: string; children?: ReactNode } & Record<string, unknown>) {
  if (external || target === "_blank" || /^https?:\/\//.test(url)) {
    return <a href={url} target={target ?? "_blank"} rel="noopener noreferrer" {...rest}>{children}</a>;
  }
  return <Link to={url} {...rest}>{children}</Link>;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { shop } = await requireShop(request);
  return { apiKey: shopifyConfig.apiKey, shop };
}
export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();
  return <ShopifyProvider embedded apiKey={apiKey}>
    <PolarisProvider i18n={translations} linkComponent={PolarisLink}>
      <NavMenu>
        <Link to="/app" rel="home">Bookings</Link>
        <Link to="/app/manage/services">Events/Services</Link>
        <Link to="/app/manage/availabilities">Availabilities</Link>
        <Link to="/app/insights">Insights</Link>
        <Link to="/app/team">Team Portal</Link>
        <Link to="/app/billing">Account and plan</Link>
        <Link to="/app/settings">Settings</Link>
      </NavMenu>
      <Outlet />
    </PolarisProvider>
  </ShopifyProvider>;
}
export function ErrorBoundary() { return boundary.error(useRouteError()); }
export const headers: HeadersFunction = (args) => boundary.headers(args);
