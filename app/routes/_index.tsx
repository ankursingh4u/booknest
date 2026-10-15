import type { LoaderFunctionArgs } from "react-router";
import { Link, redirect } from "react-router";
export function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  if (url.searchParams.has("shop")) return redirect("/app" + url.search);
  return null;
}
export default function Index() {
  return <main className="bn-login"><section className="bn-login-card">
    <p className="bn-eyebrow">BookNest</p>
    <h1>Appointments made simple</h1>
    <p>Turn Shopify products into Events/Services and keep bookings together in your store.</p>
    <Link className="bn-primary-link" to="/auth/login">Connect your store</Link>
  </section></main>;
}
