import { DateTime } from "luxon";
import { z } from "zod";
import { Form, Link, redirect, useActionData, useLoaderData, useSearchParams, useRevalidator } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Page, Card, BlockStack, Text, Badge, Banner } from "@shopify/polaris";
import { requireShop } from "../lib/auth/admin.server";
import { cancelBooking } from "../lib/bookings/service.server";
import { formError } from "../lib/admin/errors.server";
import { RecordAction } from "../components/Fields";
import { bookingFilters, bookingSelect, bookingTabs, bookingViews, calendarDays } from "../lib/bookings/views";
export async function loader({ request }: LoaderFunctionArgs) {
  const { shop, db } = await requireShop(request);
  const settings = await db.shop.findUniqueOrThrow({ where: { id: shop.id }, select: { timezone: true } });
  const filters = bookingFilters(new URL(request.url).searchParams, settings.timezone);
  const [bookings, count, locations, staff, services, insight] = await Promise.all([
    db.booking.findMany({ where: filters.where, take: filters.limit, skip: filters.view === "list" ? (filters.page - 1) * filters.limit : 0, orderBy: filters.orderBy, select: bookingSelect }),
    db.booking.count({ where: filters.where }), db.location.count({ where: { active: true } }),
    db.staffMember.findMany({ where: { active: true }, select: { id: true, firstName: true, lastName: true }, orderBy: { firstName: "asc" }, take: 500 }),
    db.service.findMany({ where: { active: true }, select: { id: true, title: true }, orderBy: { title: "asc" }, take: 500 }),
    db.insightsSnapshot.findFirst({ where: { createdAt: { gte: DateTime.utc().minus({ days: 1 }).toJSDate() } }, select: { highlights: true, nudge: true, model: true }, orderBy: { createdAt: "desc" } }),
  ]);
  const { where: _where, orderBy: _orderBy, ...controls } = filters;
  return { bookings, count, insight, ...controls, staffOptions: staff, serviceOptions: services, setup: { locations, staff: staff.length, services: services.length } };
}
export async function action({ request }: ActionFunctionArgs) {
  const { shop, db, session } = await requireShop(request);
  const form = await request.formData();
  try {
    const id = z.string().min(1).max(100).parse(form.get("id"));
    const intent = z.enum(["cancel", "checkin", "undo-checkin", "complete", "no-show"]).parse(form.get("intent"));
    if (intent === "cancel") await cancelBooking(shop.id, id);
    else await db.booking.update({ where: { id, status: "CONFIRMED" }, data: intent === "checkin" ? { checkedInAt: DateTime.utc().toJSDate(), checkedInBy: String(session.onlineAccessInfo?.associated_user.id ?? "merchant") }
      : intent === "undo-checkin" ? { checkedInAt: null, checkedInBy: null } : { status: intent === "complete" ? "COMPLETED" : "NO_SHOW" } });
    return redirect("/app?saved=1");
  } catch (error) { return formError(error); }
}
export default function Bookings() {
  const data = useLoaderData<typeof loader>();
  const { bookings, count, insight, page, tab, q, timezone, setup, view, day, staff, service, hideChecked, staffOptions, serviceOptions, limit } = data;
  const result = useActionData<typeof action>();
  const [search] = useSearchParams();
  const refresh = useRevalidator();
  const columnOptions = ["customer", "availability", "location", "order"];
  const columns = new Set(search.has("columnsConfigured") ? search.getAll("columns") : columnOptions);
  const query = (changes: Record<string, string>) => { const params = new URLSearchParams(search); params.delete("saved"); for (const [key, value] of Object.entries(changes)) params.set(key, value); return "?" + params; };
  const local = (date: Date | string) => DateTime.fromISO(typeof date === "string" ? date : date.toISOString()).setZone(timezone);
  const title = (value: string) => value[0]!.toUpperCase() + value.slice(1);
  const groups = new Map<string, typeof bookings>();
  for (const booking of bookings) {
    const key = view === "availability" ? booking.staffId : local(booking.startAt).toISODate()!;
    groups.set(key, [...(groups.get(key) ?? []), booking]);
  }
  const card = (booking: typeof bookings[number]) => <Card key={booking.id}><BlockStack gap="400">
    <div className="bn-heading-row"><Text as="h2" variant="headingMd">{booking.service.title}</Text><Badge tone={booking.status === "NEEDS_REVIEW" ? "critical" : booking.status === "CONFIRMED" ? "success" : undefined}>{booking.status.replaceAll("_", " ")}</Badge></div>
    <p>{local(booking.startAt).toFormat("ccc, dd LLL yyyy · h:mm a")} – {local(booking.endAt).toFormat("h:mm a")} · {booking.quantity} guest(s)</p>
    {columns.has("customer") && <p>{booking.customerName} · {booking.customerEmail}</p>}{columns.has("availability") && <p>{booking.staff.firstName} {booking.staff.lastName}</p>}{columns.has("location") && <p>{booking.location.name}</p>}
    <details><summary>Booking details</summary><p>ID: {booking.id}</p><p>Source: {booking.source}</p>{columns.has("order") && booking.orderId && <p>Shopify order: {booking.orderId}</p>}</details>
    {booking.status === "NEEDS_REVIEW" && <Banner tone="warning">This paid booking needs review. Check the order and arrange another time or a refund with the customer.</Banner>}
    {booking.status === "NEEDS_REVIEW" && <Link to={"/app/bookings/" + booking.id + "/reschedule"}>Review and confirm a new time</Link>}
    {booking.status === "CONFIRMED" && <div className="bn-heading-row">
      <RecordAction id={booking.id} intent={booking.checkedInAt ? "undo-checkin" : "checkin"}>{booking.checkedInAt ? "Undo check-in" : "Check in"}</RecordAction>
      <Link to={"/app/bookings/" + booking.id + "/reschedule"}>Reschedule</Link>
      <RecordAction id={booking.id} intent="complete">Complete</RecordAction><RecordAction id={booking.id} intent="no-show">No-show</RecordAction>
    </div>}
    {["CONFIRMED", "PENDING", "NEEDS_REVIEW"].includes(booking.status) && <details><summary>Cancel booking</summary><p>Cancellation does not refund a Shopify order. Handle refunds in Shopify.</p><RecordAction id={booking.id} intent="cancel">Confirm cancellation</RecordAction></details>}
  </BlockStack></Card>;
  const anchor = DateTime.fromISO(day, { zone: timezone });
  const move = (direction: number) => anchor.plus(view === "calendar" ? { months: direction } : { days: direction * (view === "agenda" ? 7 : 1) }).toISODate()!;
  return <Page title="Bookings" primaryAction={{ content: "Add a booking", url: "/app/bookings/new" }}><BlockStack gap="400">
    {result && <Banner tone="critical">{result.error}</Banner>}
    {search.has("saved") && <Banner tone="success">Booking updated.</Banner>}
    {(!setup.locations || !setup.staff || !setup.services) && <Card><BlockStack gap="400"><Text as="h2" variant="headingMd">Set up your booking calendar</Text>
      <Link to="/app/manage/locations">{setup.locations ? "✓" : "1."} Add a location and timezone</Link>
      <Link to="/app/manage/availabilities">{setup.staff ? "✓" : "2."} Add Availabilities</Link>
      <Link to="/app/schedules">3. Set working hours</Link><Link to="/app/manage/services">{setup.services ? "✓" : "4."} Create Events/Services</Link>
    </BlockStack></Card>}
    <Card><BlockStack gap="400"><div className="bn-heading-row"><h2>{insight && insight.model !== "rules-v1" ? "AI insights" : "Booking insights"}</h2><Link to="/app/insights">View insights</Link></div>
      {insight ? <><ul>{insight.highlights.map((line, i) => <li key={i}>{line}</li>)}</ul><p>{insight.nudge}</p></> : <p>Review booking trends, cancellations, and your most booked Events/Services.</p>}
    </BlockStack></Card>
    <Card><BlockStack gap="400">
      <div className="bn-heading-row"><nav className="bn-heading-row" aria-label="Booking view">{bookingViews.map(value => <Link key={value} to={query({ view: value, page: "1" })} aria-current={view === value ? "page" : undefined}>{title(value)}</Link>)}</nav>
        <button onClick={() => void refresh.revalidate()} disabled={refresh.state !== "idle"}>{refresh.state === "idle" ? "Refresh" : "Refreshing…"}</button>
      </div>
      <nav className="bn-heading-row" aria-label="Booking status">{bookingTabs.map(value => <Link key={value} to={query({ tab: value, page: "1" })} aria-current={tab === value ? "page" : undefined}>{value === "recent" ? "Recently booked" : title(value)}</Link>)}</nav>
      <Form method="get" className="bn-form"><input type="hidden" name="tab" value={tab} /><input type="hidden" name="view" value={view} />
        <div className="bn-form-grid">
          <label className="bn-field">Search<input name="q" defaultValue={q} placeholder="Name, email, booking or order ID" /></label>
          <label className="bn-field">Timezone<input name="timezone" defaultValue={timezone} /></label>
          <label className="bn-field">Availability<select name="staff" defaultValue={staff}><option value="">All Availabilities</option>{staffOptions.map(s => <option value={s.id} key={s.id}>{s.firstName} {s.lastName}</option>)}</select></label>
          <label className="bn-field">Event/Service<select name="service" defaultValue={service}><option value="">All Events/Services</option>{serviceOptions.map(s => <option value={s.id} key={s.id}>{s.title}</option>)}</select></label>
          {view !== "list" && <label className="bn-field">Date<input type="date" name="day" defaultValue={day} required /></label>}
        </div>
        <details><summary>Visible details</summary><input type="hidden" name="columnsConfigured" value="1" /><fieldset className="bn-options"><legend>Show in booking cards</legend>{columnOptions.map(column => <label key={column}><input type="checkbox" name="columns" value={column} defaultChecked={columns.has(column)} />{title(column)}</label>)}</fieldset><p>CSV exports include all details.</p></details>
        <label><input name="hideChecked" type="checkbox" value="1" defaultChecked={hideChecked} /> Hide checked-in</label>
        <button className="bn-primary-link" type="submit">Apply filters</button>
      </Form>
      <div className="bn-heading-row"><p>{count} booking(s) · times in {timezone}</p><a href={"/app/bookings.csv" + query({})} download>Export matching bookings</a></div>
      {view !== "list" && <nav className="bn-heading-row" aria-label="Date range"><Link to={query({ day: move(-1) })}>Previous {view === "calendar" ? "month" : view === "agenda" ? "week" : "day"}</Link><strong>{anchor.toFormat(view === "calendar" ? "LLLL yyyy" : "dd LLL yyyy")}</strong><Link to={query({ day: move(1) })}>Next {view === "calendar" ? "month" : view === "agenda" ? "week" : "day"}</Link></nav>}
      {view !== "list" && count > limit && <Banner tone="warning">Showing {limit} of {count} bookings. Filter by Availability or Event/Service to see the rest.</Banner>}
    </BlockStack></Card>
    {!bookings.length && <Card><Text as="p">No bookings match these filters.</Text></Card>}
    {view === "calendar" ? <div className="bn-calendar" aria-label="Monthly bookings">{calendarDays(day, timezone).map(cell => <section key={cell.date} className={"bn-calendar-day" + (cell.inMonth ? "" : " bn-calendar-padding")}>
      <h2>{cell.label}</h2>{cell.inMonth && (groups.get(cell.date) ?? []).map(booking => <Link className="bn-calendar-booking" key={booking.id} to={query({ view: "list", q: booking.id, tab: "all", page: "1" })}>
        <time>{local(booking.startAt).toFormat("h:mm a")}</time><strong>{booking.service.title}</strong>{columns.has("customer") && <span>{booking.customerName || booking.customerEmail}</span>}
      </Link>)}
    </section>)}</div> : view === "list" ? bookings.map(card) : [...groups.entries()].map(([key, rows]) => <section key={key} className="bn-booking-group">
      <h2>{view === "availability" ? rows[0]!.staff.firstName + " " + rows[0]!.staff.lastName : DateTime.fromISO(key, { zone: timezone }).toFormat("cccc, dd LLL yyyy")}</h2>
      <BlockStack gap="400">{rows.map(card)}</BlockStack>
    </section>)}
    {view === "list" && <nav className="bn-heading-row" aria-label="Pages">{page > 1 && <Link to={query({ page: String(page - 1) })}>Previous</Link>}<span>Page {page}</span>{page * limit < count && <Link to={query({ page: String(page + 1) })}>Next</Link>}</nav>}
  </BlockStack></Page>;
}
