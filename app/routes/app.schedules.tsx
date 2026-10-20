import { Form, redirect, useActionData, useLoaderData, useLocation } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Page, Card, BlockStack, Text, Banner } from "@shopify/polaris";
import { z } from "zod";
import { DateTime } from "luxon";
import { requireShop } from "../lib/auth/admin.server";
import { withShopTransaction } from "../db.server";
import { catalogData, CatalogError } from "../lib/admin/catalog.server";
import { ruleSchema, blackoutSchema, additionalHoursSchema, formValues } from "../lib/admin/schemas";
import { formError } from "../lib/admin/errors.server";
import { AdminField as Field, AdminSelectField as SelectField, AdminSaveButton as SaveButton, AdminRecordAction as RecordAction, AdminTimezoneField } from "../components/AdminFields";
import { decideTimeOff, revokeTimeOff } from "../lib/team/time-off.server";
const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export async function loader({ request }: LoaderFunctionArgs) {
  const { shop, db } = await requireShop(request);
  const [catalog, rules, blackouts, timeOff, additionalHours] = await Promise.all([catalogData(shop.id),
    db.availabilityRule.findMany({ orderBy: [{ weekday: "asc" }, { startTime: "asc" }], take: 1000 }),
    db.blackout.findMany({ where: { endAt: { gte: DateTime.utc().toJSDate() } }, orderBy: { startAt: "asc" }, take: 500 }),
    db.timeOffRequest.findMany({ where: { status: { in: ["PENDING", "APPROVED"] }, endAt: { gte: DateTime.utc().toJSDate() } }, include: { staff: { select: { firstName: true, lastName: true } } }, orderBy: { startAt: "asc" }, take: 500 }),
    db.additionalHours.findMany({ where: { endAt: { gte: DateTime.utc().toJSDate() } }, include: { staff: { select: { firstName: true, lastName: true } }, location: { select: { name: true } } }, orderBy: { startAt: "asc" }, take: 500 }),
  ]);
  return { additionalHours, timeOff, timezone: catalog.shop.timezone, rules, blackouts,
    staff: catalog.staff.filter(s => s.active).map(s => ({ value: s.id, label: s.firstName + " " + s.lastName })),
    services: catalog.services.filter(s => s.active).map(s => ({ value: s.id, label: s.title })),
    locations: catalog.locations.filter(s => s.active).map(s => ({ value: s.id, label: s.name })),
  };
}
export async function action({ request }: ActionFunctionArgs) {
  const { db, shop } = await requireShop(request);
  const form = await request.formData();
  try {
    const intent = z.enum(["additional.save", "additional.delete", "rule.save", "rule.delete", "blackout.save", "blackout.delete", "timeoff.approve", "timeoff.decline", "timeoff.revoke"]).parse(form.get("intent"));
    if (intent === "additional.save") {
      const parsed = additionalHoursSchema.parse(formValues(form));
      if (parsed.endAt <= DateTime.utc().toJSDate()) throw new CatalogError("This opening has already ended. Choose current or future hours.");
      const assigned = await db.staffMember.findMany({ where: { active: true, locationIds: { has: parsed.locationId } }, select: { id: true } });
      if (parsed.staffId && !assigned.some(person => person.id === parsed.staffId)) throw new CatalogError("Choose an active Availability assigned to this location.");
      if (!parsed.staffId && !assigned.length) throw new CatalogError("Add an active Availability to this location before adding extra hours.");
      const locks = parsed.staffId ? [parsed.staffId] : assigned.map(person => person.id).sort();
      await withShopTransaction(shop.id, async tx => {
        if (!await tx.location.findFirst({ where: { id: parsed.locationId, active: true }, select: { id: true } })) throw new CatalogError("Choose an active location.");
        const current = await tx.staffMember.findMany({ where: { active: true, locationIds: { has: parsed.locationId } }, select: { id: true } });
        if (parsed.staffId && !current.some(person => person.id === parsed.staffId)) throw new CatalogError("Choose an active Availability assigned to this location.");
        if (await tx.additionalHours.count({ where: { locationId: parsed.locationId, endAt: { gt: DateTime.utc().toJSDate() } } }) >= 1000) throw new CatalogError("Remove older additional openings before adding more.");
        await tx.additionalHours.create({ data: { ...parsed, shopId: shop.id } });
      }, locks);
    } else if (intent === "additional.delete") {
      const id = z.string().min(1).max(100).parse(form.get("id"));
      const existing = await db.additionalHours.findUnique({ where: { id } });
      if (!existing) throw new Response("Opening hours not found.", { status: 404 });
      const locks = existing.staffId ? [existing.staffId] : (await db.staffMember.findMany({ where: { locationIds: { has: existing.locationId } }, select: { id: true } })).map(person => person.id).sort();
      await withShopTransaction(shop.id, async tx => {
        const current = await tx.additionalHours.findUnique({ where: { id } });
        if (!current) throw new Response("Opening hours not found.", { status: 404 });
        if (await tx.reservation.count({ where: { locationId: current.locationId, ...(current.staffId ? { staffId: current.staffId } : {}),
          startAt: { lt: current.endAt }, endAt: { gt: current.startAt }, expiresAt: { gt: DateTime.utc().toJSDate() }, booking: null } })) {
          throw new CatalogError("A customer is completing checkout during these hours. Wait for that hold to expire before removing them.");
        }
        await tx.additionalHours.delete({ where: { id } });
      }, locks);
    } else if (intent === "timeoff.revoke") await revokeTimeOff(shop.id, z.string().min(1).max(100).parse(form.get("id")));
    else if (intent.startsWith("timeoff.")) await decideTimeOff(shop.id, z.string().min(1).max(100).parse(form.get("id")), intent === "timeoff.approve" ? "APPROVED" : "DECLINED");
    else if (intent.endsWith("delete")) {
      const id = z.string().min(1).max(100).parse(form.get("id"));
      if (intent === "rule.delete") await db.availabilityRule.delete({ where: { id } });
      else await db.blackout.delete({ where: { id } });
    } else if (intent === "rule.save") await db.availabilityRule.create({ data: { ...ruleSchema.parse(formValues(form)), shopId: shop.id } });
    else await db.blackout.create({ data: { ...blackoutSchema.parse(formValues(form)), shopId: shop.id } });
    return redirect("/app/schedules");
  } catch (error) { return formError(error); }
}
export default function Schedules() {
  const { additionalHours, timeOff, timezone, rules, blackouts, staff, services, locations } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const location = useLocation();
  const format = (value: Date | string, zone: string) => (typeof value === "string" ? DateTime.fromISO(value) : DateTime.fromJSDate(value)).setZone(zone).toFormat("dd LLL yyyy, HH:mm");
  const name = (id: string | null, options: { value: string; label: string }[]) => options.find(o => o.value === id)?.label ?? "All";
  return <Page title="Schedules" subtitle="Weekly hours, one-off extra openings, and time off for your Availabilities"><BlockStack gap="400">
    {result && <Banner tone="critical"><p>{result.error}</p>{Object.entries(result.fields).map(([key, errors]) => errors?.map(error => <p key={key + error}>{error}</p>))}</Banner>}
    <div className="bn-form-grid"><Card><Form method="post" className="bn-form" key={"rule-" + location.key}>
      <Text as="h2" variant="headingMd">Add weekly hours</Text><input type="hidden" name="intent" value="rule.save" />
      <p>Recurring hours that repeat every week. Use this for an Availability who works the same hours every week, indefinitely.{!rules.length && " Add working hours before accepting bookings."}</p>
      <SelectField name="staffId" label="Availability" options={staff} />
      <SelectField name="serviceId" label="Event/Service" options={services} />
      <SelectField name="weekday" label="Day" value="1" required options={weekdays.map((label, value) => ({ label, value: String(value) }))} />
      <Field name="startTime" label="Start time" type="time" value="09:00" required /><Field name="endTime" label="End time" type="time" value="17:00" required />
      <AdminTimezoneField name="timezone" label="Timezone" value={timezone} required />
      <SaveButton>Add hours</SaveButton>
    </Form></Card>
    <Card><Form method="post" className="bn-form" key={"blackout-" + location.key}>
      <Text as="h2" variant="headingMd">Add time off or closure</Text><input type="hidden" name="intent" value="blackout.save" />
      <SelectField name="staffId" label="Availability (blank for everyone)" options={staff} />
      <SelectField name="locationId" label="Location (blank for all locations)" options={locations} />
      <Field name="startLocal" label="Starts" type="datetime-local" required /><Field name="endLocal" label="Ends" type="datetime-local" required />
      <AdminTimezoneField name="timezone" label="Timezone" value={timezone} required /><Field name="reason" label="Reason" />
      <SaveButton>Add time off</SaveButton>
    </Form></Card></div>
    {rules.length > 0 && <Card><BlockStack gap="400"><Text as="h2" variant="headingMd">Weekly hours</Text>
      {rules.map(rule => <article className="bn-record" key={rule.id}><div><strong>{rule.staffId ? name(rule.staffId, staff) : name(rule.serviceId, services)}</strong>
        <p>{weekdays[rule.weekday]} · {rule.startTime}–{rule.endTime} · {rule.timezone}</p></div><RecordAction id={rule.id} intent="rule.delete">Remove</RecordAction></article>)}
    </BlockStack></Card>}
    {blackouts.length > 0 && <Card><BlockStack gap="400"><Text as="h2" variant="headingMd">Upcoming closures and time off</Text>
      {blackouts.map(item => <article className="bn-record" key={item.id}><div><strong>{item.reason || "Time off"}</strong>
        <p>{name(item.staffId, staff)} · {name(item.locationId, locations)}</p>
        <p>{format(item.startAt, timezone)} – {format(item.endAt, timezone)}</p></div>
        <RecordAction id={item.id} intent="blackout.delete">Remove</RecordAction></article>)}
    </BlockStack></Card>}
    {timeOff.length > 0 && <Card><BlockStack gap="400"><Text as="h2" variant="headingMd">Time-off requests</Text>
      {timeOff.map(item => <article className="bn-record" key={item.id}><div><strong>{item.staff.firstName} {item.staff.lastName}</strong>
        <p>{DateTime.fromISO(typeof item.startAt === "string" ? item.startAt : item.startAt.toISOString()).setZone(timezone).toFormat("dd LLL yyyy, HH:mm")} – {DateTime.fromISO(typeof item.endAt === "string" ? item.endAt : item.endAt.toISOString()).setZone(timezone).toFormat("dd LLL yyyy, HH:mm")}</p>
        <p>{item.reason} · {item.status}</p></div>{item.status === "APPROVED" && <RecordAction id={item.id} intent="timeoff.revoke">Remove approval</RecordAction>}{item.status === "PENDING" && <div className="bn-heading-row"><RecordAction id={item.id} intent="timeoff.approve">Approve</RecordAction><RecordAction id={item.id} intent="timeoff.decline">Decline</RecordAction></div>}
      </article>)}
    </BlockStack></Card>}
    <Card><details><summary><Text as="span" variant="headingMd" fontWeight="semibold">Add opening hours for one date (optional)</Text></summary>
      <Form method="post" className="bn-form" key={"additional-" + location.key}>
        <input type="hidden" name="intent" value="additional.save" />
        <p>For a single extra date only - not for regular availability. Weekly hours still apply on top of this. Closures, time off, calendar conflicts, and Event/Service booking hours still limit available times.</p>
        <div className="bn-form-grid">
          <SelectField name="locationId" label="Location" options={locations} required />
          <SelectField name="staffId" label="Availability (blank for everyone at this location)" options={staff} />
          <Field name="date" label="Date" type="date" required />
          <AdminTimezoneField name="timezone" label="Timezone" value={timezone} required />
          <Field name="startTime" label="Opens" type="time" value="09:00" required />
          <Field name="endTime" label="Closes" type="time" value="17:00" required />
        </div>
        <p>If the closing time is earlier than the opening time, it falls on the next date.</p>
        <Field name="note" label="Note" /><SaveButton>Add opening hours</SaveButton>
      </Form>
    </details></Card>
    {additionalHours.length > 0 && <Card><BlockStack gap="400"><Text as="h2" variant="headingMd">Additional opening hours</Text>
      {additionalHours.map(item => <article className="bn-record" key={item.id}><div>
        <strong>{item.staff ? item.staff.firstName + " " + item.staff.lastName : "All Availabilities"} · {item.location.name}</strong>
        <p>{format(item.startAt, item.timezone)} – {format(item.endAt, item.timezone)} · {item.timezone}</p>{item.note && <p>{item.note}</p>}
      </div><RecordAction id={item.id} intent="additional.delete">Remove</RecordAction></article>)}
      {additionalHours.length >= 500 && <p>Showing the first 500 upcoming openings.</p>}
      <p>Removing opening hours leaves existing appointments in place.</p>
    </BlockStack></Card>}
  </BlockStack></Page>;
}
