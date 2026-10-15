export function loader() {
  return Response.json({ status: "ok", app: "booknest" }, { headers: { "Cache-Control": "no-store" } });
}
