// App Bridge must be loaded in the document <head> on every embedded admin document so it is
// present on the session-token bounce page and can refresh the token without a manual reload.
// It must NOT load on public pages (team portal, booking portal) where there is no Shopify
// admin frame to broker a session with.
export function appBridgeApiKey(pathname: string, apiKey: string): string | null {
  return pathname === "/app" || pathname.startsWith("/app/") ? apiKey : null;
}
