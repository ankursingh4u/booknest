import { z } from "zod";
import { DateTime, IANAZone } from "luxon";
const text = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) => text(max).optional().transform(value => value || null);
export const timezoneSchema = z.string().refine(IANAZone.isValidZone, "Choose a valid IANA timezone.");
const id = z.string().min(1).max(100);
const optionalId = z.preprocess(value => value === "" ? undefined : value, id.optional());
const int = (min: number, max: number) => z.coerce.number().int().min(min).max(max);
const url = z.string().trim().url().refine(value => {
  const parsed = new URL(value);
  return parsed.protocol === "https:" && !parsed.username && !parsed.password;
}, "Use an HTTPS link without credentials.");
const optionalUrl = z.preprocess(value => value === "" ? undefined : value, url.optional()).transform(value => value ?? null);
const money = z.string().regex(/^\d{1,7}(?:\.\d{1,2})?$/, "Use a price with at most two decimal places.")
  .transform(value => { const [whole, fraction = ""] = value.split("."); return Number(whole) * 100 + Number(fraction.padEnd(2, "0")); });
export const locationSchema = z.object({
  name: text(120).min(1), address: optionalText(500), timezone: timezoneSchema,
});
export const staffSchema = z.object({
  firstName: text(100).min(1), lastName: text(100).min(1), email: z.string().trim().email().max(254),
  phone: optionalText(50), contactLink: optionalUrl, imageUrl: optionalUrl, bio: optionalText(2000),
  timezone: timezoneSchema, locationIds: z.array(id).min(1).max(50).transform(ids => [...new Set(ids)]),
});
export const serviceSchema = z.object({
  productMode: z.enum(["existing", "new"]).default("existing"),
  title: text(160).min(1), slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100),
  description: optionalText(5000), locationId: id, staffIds: z.array(id).min(1).max(50).transform(ids => [...new Set(ids)]),
  slotIntervalMin: z.preprocess(value => value === "" || value == null ? null : value, int(1, 1440).nullable()).default(null),
  customerCancelCutoffHours: int(0, 8760).default(0), customerRescheduleCutoffHours: int(0, 8760).default(0),
  durationMin: int(5, 1440), capacity: int(1, 1000), bufferBefore: int(0, 1440).default(0), bufferAfter: int(0, 1440).default(0),
  price: money, depositType: z.enum(["NONE", "FULL", "FIXED", "PERCENT"]).default("NONE"),
  depositValue: money.default("0"),
  variantId: z.string().trim().regex(/^(?:gid:\/\/shopify\/ProductVariant\/)?\d+$|^$/).optional()
    .transform(value => value ? value.startsWith("gid:") ? value : "gid://shopify/ProductVariant/" + value : null),
  minNoticeHours: int(0, 8760).default(1), maxAdvanceDays: int(1, 365).default(60),
}).superRefine((value, ctx) => {
  if (value.price > 0 && value.productMode !== "new" && !value.variantId) ctx.addIssue({ code: "custom", path: ["variantId"], message: "Link a Shopify product variant for paid bookings." });
  if (value.depositType === "FIXED" && (value.depositValue <= 0 || value.depositValue > value.price))
    ctx.addIssue({ code: "custom", path: ["depositValue"], message: "Fixed deposit must be greater than zero and no more than the price." });
  if (value.depositType === "PERCENT" && (value.depositValue <= 0 || value.depositValue > 10000 || value.depositValue % 100 !== 0))
    ctx.addIssue({ code: "custom", path: ["depositValue"], message: "Percentage must be a whole number from 1 to 100." });
}).transform(({ price, depositValue, ...value }) => ({
  ...value, priceCents: price, isPrivate: value.capacity === 1,
  depositValue: value.depositType === "PERCENT" ? depositValue / 100 : ["NONE", "FULL"].includes(value.depositType) ? 0 : depositValue,
}));
const wallTime = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export const ruleSchema = z.object({
  staffId: optionalId, serviceId: optionalId, weekday: int(0, 6), startTime: wallTime, endTime: wallTime, timezone: timezoneSchema,
}).superRefine((value, ctx) => {
  if (Boolean(value.staffId) === Boolean(value.serviceId)) ctx.addIssue({ code: "custom", path: ["staffId"], message: "Choose one Availability or one Event/Service." });
  if (value.startTime === value.endTime) ctx.addIssue({ code: "custom", path: ["endTime"], message: "Start and end times must differ." });
});

export const additionalHoursSchema = z.object({
  locationId: id, staffId: optionalId, note: optionalText(500),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), startTime: wallTime, endTime: wallTime, timezone: timezoneSchema,
}).superRefine((value, ctx) => {
  const day = DateTime.fromISO(value.date, { zone: value.timezone });
  if (!day.isValid || day.toISODate() !== value.date) {
    ctx.addIssue({ code: "custom", path: ["date"], message: "Choose a calendar date that exists in this timezone." });
    return;
  }
  if (value.startTime === value.endTime) {
    ctx.addIssue({ code: "custom", path: ["endTime"], message: "Start and end times must differ." });
    return;
  }
  const endDate = value.endTime < value.startTime ? day.plus({ days: 1 }).toISODate()! : value.date;
  for (const [key, date] of [["startTime", value.date], ["endTime", endDate]] as const) {
    const local = DateTime.fromISO(date + "T" + value[key], { zone: value.timezone });
    if (!local.isValid || local.toFormat("yyyy-MM-dd'T'HH:mm") !== date + "T" + value[key] || local.getPossibleOffsets().length !== 1) {
      ctx.addIssue({ code: "custom", path: [key], message: "Choose an unambiguous local time that exists in this timezone." });
    }
  }
}).transform(({ date, startTime, endTime, ...value }) => {
  const day = DateTime.fromISO(date, { zone: value.timezone });
  const endDate = endTime < startTime ? day.plus({ days: 1 }).toISODate()! : date;
  return { ...value, startAt: DateTime.fromISO(date + "T" + startTime, { zone: value.timezone }).toUTC().toJSDate(),
    endAt: DateTime.fromISO(endDate + "T" + endTime, { zone: value.timezone }).toUTC().toJSDate() };
});

export const blackoutSchema = z.object({
  staffId: optionalId, locationId: optionalId, reason: optionalText(500),
  startLocal: z.string(), endLocal: z.string(), timezone: timezoneSchema,
}).superRefine((value, ctx) => {
  const start = DateTime.fromISO(value.startLocal, { zone: value.timezone });
  const end = DateTime.fromISO(value.endLocal, { zone: value.timezone });
  for (const [key, time] of [["startLocal", start], ["endLocal", end]] as const) {
    if (!time.isValid || time.toFormat("yyyy-MM-dd'T'HH:mm") !== value[key] || time.getPossibleOffsets().length !== 1) {
      ctx.addIssue({ code: "custom", path: [key], message: "Choose an unambiguous local time that exists in this timezone." });
    }
  }
  if (end <= start) ctx.addIssue({ code: "custom", path: ["endLocal"], message: "End must be after start." });
}).transform(({ startLocal, endLocal, timezone, ...value }) => ({
  ...value, startAt: DateTime.fromISO(startLocal, { zone: timezone }).toUTC().toJSDate(),
  endAt: DateTime.fromISO(endLocal, { zone: timezone }).toUTC().toJSDate(),
}));
export function formValues(form: FormData) {
  const values: Record<string, unknown> = Object.fromEntries(form);
  for (const field of ["staffIds", "locationIds"]) values[field] = form.getAll(field).filter(value => typeof value === "string" && value);
  return values;
}
