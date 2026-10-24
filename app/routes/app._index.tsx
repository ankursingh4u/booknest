import { useState } from "react";
import { DateTime } from "luxon";
import { z } from "zod";
import { Link, redirect, useActionData, useLoaderData, useNavigate, useSearchParams, useRevalidator } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Page, Card, BlockStack, Text, Badge, Banner, TextField, Select, Button, Tabs, EmptyState } from "@shopify/polaris";
import { requireShop } from "../lib/auth/admin.server";
import { cancelBooking, monthLoad } from "../lib/bookings/service.server";
import { formError } from "../lib/admin/errors.server";
import { AdminRecordAction, AdminCheckbox } from "../components/AdminFields";
import { bookingFilters, bookingSelect, bookingTabs, bookingViews, calendarDays } from "../lib/bookings/views";
import { logAccess } from "../lib/audit/access-log.server";
export async function loader({ request }: LoaderFunctionArgs) {
  const { shop, db, session } = await requireShop(request);
  const settings = await db.shop.findUniqueOrThrow({ where: { id: shop.id }, select: { timezone: true } });
  const filters = bookingFilters(new URL(request.url).searchParams, settings.timezone);
  const [bookings, count, locations, staff, services, insight] = await Promise.all([
    db.booking.findMany({ where: filters.where, take: filters.limit, skip: filters.view === "list" ? (filters.page - 1) * filters.limit : 0, orderBy: filters.orderBy, select: bookingSelect }),
    db.booking.count({ where: filters.where }), db.location.count({ where: { active: true } }),
    db.staffMember.findMany({ where: { active: true }, select: { id: true, firstName: true, lastName: true }, orderBy: { firstName: "asc" }, take: 500 }),
    db.service.findMany({ where: { active: true }, select: { id: true, title: true }, orderBy: { title: "asc" }, take: 500 }),
    db.insightsSnapshot.findFirst({ where: { createdAt: { gte: DateTime.utc().minus({ days: 1 }).toJSDate() } }, select: { highlights: true, nudge: true, model: true }, orderBy: { createdAt: "desc" } }),
  ]);
  const load = filters.view === "calendar" ? await monthLoad(shop.id, filters.day.slice(0, 7), filters.timezone) : {};
  await logAccess(shop.id, String(session.onlineAccessInfo?.associated_user.id ?? "merchant"), "view_bookings", bookings.length);
  const { where: _where, orderBy: _orderBy, ...controls } = filters;
  return { bookings, count, insight, load, ...controls, staffOptions: staff, serviceOptions: services, setup: { locations, staff: staff.length, services: services.length } };
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
  const { bookings, count, insight, load, page, tab, q, timezone, setup, view, day, staff, service, hideChecked, staffOptions, serviceOptions, limit } = data;
  const result = useActionData<typeof action>();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const refresh = useRevalidator();
  const [qValue, setQValue] = useState(q);
  const [dayValue, setDayValue] = useState(day);
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
  const card = (booking: typeof bookings[number]) => <Card key={booking.id}><div className="bn-booking-card"><BlockStack gap="300">
    <div className="bn-heading-row"><Text as="h2" variant="headingMd">{booking.service.title}</Text><Badge tone={booking.status === "NEEDS_REVIEW" ? "critical" : booking.status === "CONFIRMED" ? "success" : undefined}>{booking.status.replaceAll("_", " ")}</Badge></div>
    <div className="bn-booking-lines">
      <p className="bn-booking-when">{local(booking.startAt).toFormat("ccc, dd LLL yyyy · h:mm a")} – {local(booking.endAt).toFormat("h:mm a")} · {booking.quantity} guest(s)</p>
      {columns.has("customer") && <p>{booking.customerName} · {booking.customerEmail}</p>}
      {columns.has("availability") && <p>{booking.staff.firstName} {booking.staff.lastName}</p>}
      {columns.has("location") && <p>{booking.location.name}</p>}
    </div>
    <details><summary>Booking details</summary><div className="bn-booking-lines"><p>ID: {booking.id}</p><p>Source: {booking.source}</p>{columns.has("order") && booking.orderId && <p>Shopify order: {booking.orderId}</p>}</div></details>
    {booking.status === "NEEDS_REVIEW" && <Banner tone="warning">This paid booking needs review. Check the order and arrange another time or a refund with the customer.</Banner>}
    {booking.status === "NEEDS_REVIEW" && <Link to={"/app/bookings/" + booking.id + "/reschedule"}>Review and confirm a new time</Link>}
    {booking.status === "CONFIRMED" && <div className="bn-actions">
      <AdminRecordAction id={booking.id} intent={booking.checkedInAt ? "undo-checkin" : "checkin"} variant="secondary">{booking.checkedInAt ? "Undo check-in" : "Check in"}</AdminRecordAction>
      <Button onClick={() => navigate("/app/bookings/" + booking.id + "/reschedule")}>Reschedule</Button>
      <AdminRecordAction id={booking.id} intent="complete" variant="secondary">Complete</AdminRecordAction>
      <AdminRecordAction id={booking.id} intent="no-show" variant="secondary">No-show</AdminRecordAction>
    </div>}
    {["CONFIRMED", "PENDING", "NEEDS_REVIEW"].includes(booking.status) && <details><summary>Cancel booking</summary><BlockStack gap="200"><p>Cancellation does not refund a Shopify order. Handle refunds in Shopify.</p><div className="bn-actions"><AdminRecordAction id={booking.id} intent="cancel" variant="secondary">Confirm cancellation</AdminRecordAction></div></BlockStack></details>}
  </BlockStack></div></Card>;
  const anchor = DateTime.fromISO(day, { zone: timezone });
  const move = (direction: number) => anchor.plus(view === "calendar" ? { months: direction } : { days: direction * (view === "agenda" ? 7 : 1) }).toISODate()!;
  return <Page title="Bookings" subtitle="View, filter, and manage customer bookings" primaryAction={{ content: "Add a booking", url: "/app/bookings/new" }}><BlockStack gap="400">
    {result && <Banner tone="critical">{result.error}</Banner>}
    {search.has("saved") && <Banner tone="success">Booking updated.</Banner>}
    {(!setup.locations || !setup.staff || !setup.services) && <Banner tone="warning" title="Finish setting up your booking calendar"
      action={{ content: "Continue setup", url: "/app/setup" }}>
      <p>{[setup.locations, setup.staff, setup.services].filter(Boolean).length} of 3 setup steps complete.</p>
    </Banner>}
    <Banner tone="info" title={insight && insight.model !== "rules-v1" ? "AI insights" : "Booking insights"}>
      {insight ? <BlockStack gap="200"><ul>{insight.highlights.map((line, i) => <li key={i}>{line}</li>)}</ul><p>{insight.nudge}</p><Link to="/app/insights">View insights</Link></BlockStack>
        : <BlockStack gap="200"><p>Review booking trends, cancellations, and your most booked Events/Services.</p><Link to="/app/insights">View insights</Link></BlockStack>}
    </Banner>
    <Card padding="0"><BlockStack gap="0">
      <div className="bn-heading-row" style={{ padding: "var(--bn-space-4)" }}>
        <Tabs tabs={bookingViews.map(value => ({ id: value, content: title(value) }))}
          selected={bookingViews.indexOf(view)}
          onSelect={index => navigate(query({ view: bookingViews[index]!, page: "1" }))} />
        <Button onClick={() => void refresh.revalidate()} disabled={refresh.state !== "idle"} loading={refresh.state !== "idle"}>{refresh.state === "idle" ? "Refresh" : "Refreshing…"}</Button>
      </div>
      <div className="bn-filter-controls">
        <TextField label="Search bookings" labelHidden value={qValue} placeholder="Name, email, booking or order ID"
          autoComplete="off" clearButton onClearButtonClick={() => { setQValue(""); navigate(query({ q: "", page: "1" })); }}
          onChange={setQValue} onBlur={() => { if (qValue !== q) navigate(query({ q: qValue, page: "1" })); }} />
        <div className="bn-filter-row">
          <Select labelHidden label="Status" value={tab} onChange={value => navigate(query({ tab: value, page: "1" }))}
            options={bookingTabs.map(value => ({ value, label: value === "recent" ? "Recently booked" : title(value) }))} />
          <Select labelHidden label="Availability" value={staff} onChange={value => navigate(query({ staff: value, page: "1" }))}
            options={[{ value: "", label: "All Availabilities" }, ...staffOptions.map(s => ({ value: s.id, label: s.firstName + " " + s.lastName }))]} />
          <Select labelHidden label="Event/Service" value={service} onChange={value => navigate(query({ service: value, page: "1" }))}
            options={[{ value: "", label: "All Events/Services" }, ...serviceOptions.map(s => ({ value: s.id, label: s.title }))]} />
          <AdminCheckbox name="hideChecked" value="1" label="Hide checked-in" defaultChecked={hideChecked}
            onToggle={checked => navigate(query({ hideChecked: checked ? "1" : "", page: "1" }))} />
          {(tab !== "upcoming" || staff || service || hideChecked || q) &&
            <Button variant="plain" onClick={() => navigate(query({ q: "", staff: "", service: "", hideChecked: "", tab: "upcoming", page: "1" }))}>Clear filters</Button>}
        </div>
      </div>
      <div style={{ padding: "var(--bn-space-4)" }}><BlockStack gap="400">
        {view !== "list" && <TextField label="Date" type="date" value={dayValue} onChange={value => { setDayValue(value); navigate(query({ day: value })); }} autoComplete="off" />}
        <details><summary>Visible details</summary><fieldset className="bn-options"><legend>Show in booking cards</legend>
          {columnOptions.map(column => <AdminCheckbox key={column} name="columns" value={column} label={title(column)} defaultChecked={columns.has(column)}
            onToggle={checked => {
              const next = new Set(columns); if (checked) next.add(column); else next.delete(column);
              const params = new URLSearchParams(search); params.delete("saved"); params.delete("columns");
              params.set("columnsConfigured", "1"); for (const value of next) params.append("columns", value);
              navigate("?" + params);
            }} />)}
        </fieldset><p>CSV exports include all details.</p></details>
        <div className="bn-heading-row"><p>{count} booking(s) · times in {timezone}</p><a href={"/app/bookings.csv" + query({})} download>Export matching bookings</a></div>
        {view !== "list" && <nav className="bn-heading-row" aria-label="Date range"><Link to={query({ day: move(-1) })}>Previous {view === "calendar" ? "month" : view === "agenda" ? "week" : "day"}</Link><strong>{anchor.toFormat(view === "calendar" ? "LLLL yyyy" : "dd LLL yyyy")}</strong><Link to={query({ day: move(1) })}>Next {view === "calendar" ? "month" : view === "agenda" ? "week" : "day"}</Link></nav>}
        {view !== "list" && count > limit && <Banner tone="warning">Showing {limit} of {count} bookings. Filter by Availability or Event/Service to see the rest.</Banner>}
      </BlockStack></div>
    </BlockStack></Card>
    {!bookings.length && <Card><EmptyState heading="No bookings here yet" image="https://cdn.shopify.com/s/files/1/0757/9955/files/empty-state.svg"
      action={{ content: "Add a booking", url: "/app/bookings/new" }}>
      <p>Bookings show here when customers book on your store, or when you add one yourself.</p>
    </EmptyState></Card>}
    {view === "calendar" && <div className="bn-legend" aria-hidden="true">
      <span className="bn-legend-item bn-day-free">Free</span>
      <span className="bn-legend-item bn-day-busy">Filling up</span>
      <span className="bn-legend-item bn-day-full">Full</span>
      <span className="bn-legend-item bn-day-closed">Closed / past</span>
    </div>}
    {view === "calendar" ? <div className="bn-calendar" aria-label="Monthly bookings">{calendarDays(day, timezone).map(cell => <section key={cell.date} className={"bn-calendar-day" + (cell.inMonth ? " bn-day-" + (load[cell.date] ?? "closed") : " bn-calendar-padding")}>
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
