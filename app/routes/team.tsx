import { DateTime } from "luxon";
import { z } from "zod";
import { Form, Link, redirect, useActionData, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { requireTeam } from "../lib/team/auth.server";
import { requestTimeOff } from "../lib/team/time-off.server";
import { requireSameOrigin, teamCookie, teamHeaders } from "../lib/team/session.server";
import { formError } from "../lib/admin/errors.server";
export const headers = () => teamHeaders;
export async function loader({ request }: LoaderFunctionArgs) {
  const { db, staff } = await requireTeam(request);
  const requested = new URL(request.url).searchParams.get("day") || "";
  const parsed = DateTime.fromISO(requested, { zone: staff.timezone });
  const start = /^\d{4}-\d{2}-\d{2}$/.test(requested) && parsed.isValid ? parsed.startOf("day") : DateTime.now().setZone(staff.timezone).startOf("day");
  const [bookings, requests] = await Promise.all([
    db.booking.findMany({ where: { staffId: staff.id, startAt: { gte: start.toJSDate(), lt: start.plus({ days: 7 }).toJSDate() }, status: { in: ["CONFIRMED", "COMPLETED", "NO_SHOW"] } },
      select: { id: true, startAt: true, endAt: true, quantity: true, status: true, customerName: true, customerEmail: true, checkedInAt: true,
        service: { select: { title: true } }, location: { select: { name: true } } }, orderBy: { startAt: "asc" }, take: 200 }),
    db.timeOffRequest.findMany({ where: { staffId: staff.id }, select: { id: true, startAt: true, endAt: true, reason: true, status: true }, orderBy: { createdAt: "desc" }, take: 50 }),
  ]);
  return { staff, bookings, requests, day: start.toISODate()!, previous: start.minus({ days: 7 }).toISODate()!, next: start.plus({ days: 7 }).toISODate()! };
}
export async function action({ request }: ActionFunctionArgs) {
  requireSameOrigin(request);
  const { db, shopId, seat, staff } = await requireTeam(request);
  const form = await request.formData();
  try {
    const intent = z.enum(["checkin", "undo-checkin", "request", "withdraw", "logout"]).parse(form.get("intent"));
    if (intent === "logout") return redirect("/team/login", { headers: { ...teamHeaders, "Set-Cookie": teamCookie("", true) } });
    if (intent === "request") await requestTimeOff(shopId, staff.id, form);
    else {
      const id = z.string().min(1).max(100).parse(form.get("id"));
      if (intent === "withdraw") await db.timeOffRequest.update({ where: { id, staffId: staff.id, status: "PENDING" }, data: { status: "WITHDRAWN" } });
      else await db.booking.update({ where: { id, staffId: staff.id, status: "CONFIRMED" }, data: {
        checkedInAt: intent === "checkin" ? DateTime.utc().toJSDate() : null, checkedInBy: intent === "checkin" ? "team:" + seat.id : null,
      } });
    }
    return redirect("/team?saved=1", { headers: teamHeaders });
  } catch (error) { return formError(error); }
}
export default function TeamPortal() {
  const { staff, bookings, requests, day, previous, next } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const format = (value: string | Date) => DateTime.fromISO(typeof value === "string" ? value : value.toISOString()).setZone(staff.timezone).toFormat("ccc dd LLL, h:mm a");
  return <main className="bn-team"><header className="bn-heading-row"><div><h1>Welcome, {staff.firstName}</h1><p>Team Portal · {staff.timezone}</p></div><Form method="post"><input type="hidden" name="intent" value="logout" /><button>Sign out</button></Form></header>
    {result?.error && <p role="alert" className="bn-error">{result.error}</p>}
    <section className="bn-team-card"><h2>Your bookings</h2><Form method="get" className="bn-form"><label className="bn-field">Week starting<input name="day" type="date" defaultValue={day} required /></label><button>Show bookings</button></Form>
      <nav className="bn-heading-row"><Link to={"?day=" + previous}>Previous week</Link><Link to={"?day=" + next}>Next week</Link></nav>
      {!bookings.length && <p>No bookings this week.</p>}{bookings.length === 200 && <p>Showing the first 200 bookings. Contact your manager for the complete list.</p>}
      {bookings.map(booking => <article key={booking.id} className="bn-record"><div><h3>{booking.service.title}</h3><p>{format(booking.startAt)} – {format(booking.endAt)}</p><p>{booking.customerName || booking.customerEmail} · {booking.quantity} guest(s) · {booking.location.name}</p><p>{booking.status.replaceAll("_", " ")}</p></div>
        {booking.status === "CONFIRMED" && <Form method="post"><input type="hidden" name="id" value={booking.id} /><input type="hidden" name="intent" value={booking.checkedInAt ? "undo-checkin" : "checkin"} /><button>{booking.checkedInAt ? "Undo check-in" : "Check in"}</button></Form>}
      </article>)}
    </section>
    <section className="bn-team-card"><h2>Request time off</h2><p>Times use {staff.timezone}. Your manager must approve the request before it blocks new bookings.</p>
      <Form method="post" className="bn-form"><input type="hidden" name="intent" value="request" /><div className="bn-form-grid"><label className="bn-field">Starts<input name="startLocal" type="datetime-local" required /></label><label className="bn-field">Ends<input name="endLocal" type="datetime-local" required /></label></div>
        <label className="bn-field">Reason<textarea name="reason" maxLength={500} /></label><button>Submit request</button>
      </Form>
      {requests.map(item => <article className="bn-record" key={item.id}><div><p>{format(item.startAt)} – {format(item.endAt)}</p><p>{item.reason}</p><strong>{item.status}</strong></div>{item.status === "PENDING" && <Form method="post"><input type="hidden" name="intent" value="withdraw" /><input type="hidden" name="id" value={item.id} /><button>Withdraw</button></Form>}</article>)}
    </section>
  </main>;
}
