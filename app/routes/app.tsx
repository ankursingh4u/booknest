import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, Outlet, useLoaderData, useRouteError } from "react-router";
import { AppProvider as ShopifyProvider } from "@shopify/shopify-app-react-router/react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider as PolarisProvider } from "@shopify/polaris";
import { NavMenu } from "@shopify/app-bridge-react";
import translations from "@shopify/polaris/locales/en.json";
import { requireShop } from "../lib/auth/admin.server";
import { shopifyConfig } from "../shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { shop } = await requireShop(request);
  return { apiKey: shopifyConfig.apiKey, shop };
}
export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();
  return <ShopifyProvider embedded apiKey={apiKey}>
    <PolarisProvider i18n={translations}>
      <NavMenu>
        <Link to="/app" rel="home">Bookings</Link>
        <Link to="/app/setup">Setup guide</Link>
        <Link to="/app/manage/services">Events/Services</Link>
        <Link to="/app/manage/availabilities">Availabilities</Link>
        <Link to="/app/manage/locations">Locations</Link>
        <Link to="/app/schedules">Schedules</Link>
        <Link to="/app/intake">Intake Questions</Link>
        <Link to="/app/notifications">Notifications</Link>
        <Link to="/app/insights">Insights</Link>
        <Link to="/app/team">Team Portal</Link>
        <Link to="/app/calendar">Google Calendar</Link>
        <Link to="/app/billing">Account and plan</Link>
        <Link to="/app/settings">Settings</Link>
        <Link to="/app/support">Support</Link>
      </NavMenu>
      <Outlet />
    </PolarisProvider>
  </ShopifyProvider>;
}
export function ErrorBoundary() { return boundary.error(useRouteError()); }
export const headers: HeadersFunction = (args) => boundary.headers(args);
