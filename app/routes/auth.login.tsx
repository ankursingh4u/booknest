import { useState } from "react";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { login } from "../shopify.server";

async function signIn(request: Request) {
  const errors = await login(request);
  return { error: errors?.shop ? "Enter your store domain, such as your-store.myshopify.com." : null };
}
export const loader = ({ request }: LoaderFunctionArgs) => signIn(request);
export const action = ({ request }: ActionFunctionArgs) => signIn(request);

export default function Login() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [shop, setShop] = useState("");
  const error = (actionData ?? loaderData).error;
  return <main className="bn-login"><section className="bn-login-card">
    <p className="bn-eyebrow">BookNest</p>
    <h1>Connect your Shopify store</h1>
    <p>Manage appointments, your team’s availability, and customer bookings.</p>
    <Form method="post" aria-busy={navigation.state !== "idle"}>
      <label htmlFor="shop">Store domain</label>
      <input id="shop" name="shop" value={shop} onChange={(event) => setShop(event.target.value)}
        placeholder="your-store.myshopify.com" autoComplete="url" required
        aria-describedby={error ? "shop-error" : "shop-help"} aria-invalid={Boolean(error)} />
      {error ? <p id="shop-error" role="alert">{error}</p> : <p id="shop-help">Use your store’s myshopify.com address.</p>}
      <button type="submit" disabled={navigation.state !== "idle"}>
        {navigation.state !== "idle" ? "Connecting…" : "Continue with Shopify"}
      </button>
    </Form>
  </section></main>;
}
