import type { LoaderFunctionArgs } from "react-router";
import { requireShop } from "../lib/auth/admin.server";
import { bookingFilters, bookingSelect, serializeBookings } from "../lib/bookings/views";
import { logAccess } from "../lib/audit/access-log.server";
export async function loader({ request }: LoaderFunctionArgs) {
  const { shop, db, session } = await requireShop(request);
  const settings = await db.shop.findUniqueOrThrow({ where: { id: shop.id }, select: { timezone: true } });
  const filters = bookingFilters(new URL(request.url).searchParams, settings.timezone);
  const rows = await db.booking.findMany({ where: filters.where, select: bookingSelect, orderBy: filters.orderBy, take: 10001 });
  if (rows.length > 10000) throw new Response("More than 10,000 bookings match. Narrow the filters before exporting.", { status: 413 });
  await logAccess(shop.id, String(session.onlineAccessInfo?.associated_user.id ?? "merchant"), "export_bookings_csv", rows.length);
  return new Response(serializeBookings(rows, filters.timezone), { headers: {
    "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="booknest-bookings.csv"',
    "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
  } });
}
