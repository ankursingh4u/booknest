import { googleBusyIntervals } from "../calendar/client.server";
import { queueBookingNotifications } from "../notifications/outbox.server";
import { z } from "zod";
import { paymentDue } from "./checkout";
import type { Prisma } from "@prisma/client";
import { DateTime, IANAZone } from "luxon";
import { customerChangeError } from "./policy";
import { getShopDatabase, withShopTransaction } from "../../db.server";
import { computeSlots } from "../availability/engine";
import { BookingError, customerInput, matchesReservation, reservationInput, type ReservationInput } from "./validation";
import { dayLoadStatus, type DayLoad } from "./views";

type Database = Pick<Prisma.TransactionClient, "service" | "location" | "serviceStaff" | "staffMember" | "availabilityRule" | "additionalHours" | "blackout" | "timeOffRequest" | "booking" | "reservation" | "shop" | "intakeQuestion" | "intakeAnswer">;
async function availabilityForWindow(db: Database, shopId: string, serviceId: string, day: string, quantity: number, staffId?: string, excludeBookingId?: string, excludeReservationId?: string, now: DateTime = DateTime.utc(), enforceNotice = true, viewerTimezone?: string, monthRange = false) {
  const service = await db.service.findFirst({ where: { id: serviceId, active: true } });
  if (!service) throw new BookingError("Event/Service not found.", 404);
  const location = await db.location.findFirst({ where: { id: service.locationId, active: true } });
  if (!location) throw new BookingError("This location is not accepting bookings.", 404);
  const displayTimezone = viewerTimezone || location.timezone;
  if (!IANAZone.isValidZone(displayTimezone)) throw new BookingError("Choose a valid timezone.", 400);
  const start = DateTime.fromISO(day, { zone: displayTimezone }).startOf("day");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !start.isValid || start.toISODate() !== day) throw new BookingError("Choose a valid date.", 400);
  const end = monthRange ? start.plus({ months: 1 }) : start.plus({ days: 1 });
  const assignments = await db.serviceStaff.findMany({ where: { serviceId } });
  const staff = await db.staffMember.findMany({ where: { id: { in: assignments.map(s => s.staffId), ...(staffId ? { equals: staffId } : {}) },
    active: true, locationIds: { has: location.id } }, select: { id: true, firstName: true, lastName: true, contactLink: true, googleCalendarId: true } });
  const staffIds = staff.map(s => s.id);
  const occupiedWindow = { startAt: { lt: end.plus({ days: 2 }).toJSDate() }, endAt: { gt: start.minus({ days: 2 }).toJSDate() } };
  const [rules, additionalHours, blackouts, timeOff, bookings, reservations, shop] = await Promise.all([
    db.availabilityRule.findMany({ where: { OR: [{ staffId: { in: staffIds } }, { serviceId }] } }),
    db.additionalHours.findMany({ where: { ...occupiedWindow, locationId: location.id, OR: [{ staffId: null }, { staffId: { in: staffIds } }] } }),
    db.blackout.findMany({ where: { ...occupiedWindow, AND: [{ OR: [{ staffId: null }, { staffId: { in: staffIds } }] }, { OR: [{ locationId: null }, { locationId: location.id }] }] } }),
    db.timeOffRequest.findMany({ where: { ...occupiedWindow, staffId: { in: staffIds }, status: "APPROVED" } }),
    db.booking.findMany({ where: { ...occupiedWindow, staffId: { in: staffIds }, status: { in: ["PENDING", "CONFIRMED"] }, ...(excludeBookingId ? { id: { not: excludeBookingId } } : {}) },
      include: { service: { select: { bufferBefore: true, bufferAfter: true } } } }),
    db.reservation.findMany({ where: { ...occupiedWindow, staffId: { in: staffIds }, expiresAt: { gt: now.toJSDate() }, booking: null,
      ...(excludeReservationId ? { id: { not: excludeReservationId } } : {}) }, include: { service: { select: { bufferBefore: true, bufferAfter: true } } } }),
    db.shop.findUniqueOrThrow({ where: { id: shopId }, select: { currency: true, domain: true } }),
  ]);
  const calendarBusy = (await Promise.all(staff.filter(person => person.googleCalendarId).map(person => googleBusyIntervals(shopId, person.id, person.googleCalendarId!, start.minus({ days: 1 }), end.plus({ days: 2 }))))).flat();
  const from = (value: Date) => DateTime.fromJSDate(value, { zone: "utc" });
  const serviceRules = rules.filter(rule => rule.serviceId === serviceId);
  const slots = computeSlots({
    service: enforceNotice ? service : { ...service, minNoticeHours: 0, maxAdvanceDays: 36500 }, timezone: location.timezone, rangeStart: start.toUTC(), rangeEnd: end.toUTC(), now, staffIds, quantity,
    rules: rules.filter(rule => Boolean(rule.staffId)).map(rule => ({ ...rule, staffId: rule.staffId! })),
    additionalHours: additionalHours.map(interval => ({ startAt: from(interval.startAt), endAt: from(interval.endAt), staffId: interval.staffId ?? undefined, timezone: interval.timezone })),
    serviceRules: serviceRules.length ? serviceRules.map(rule => ({ ...rule, staffId: undefined })) : undefined,
    blackouts: [...calendarBusy, ...[...blackouts, ...timeOff].map(interval => ({ startAt: from(interval.startAt), endAt: from(interval.endAt), staffId: interval.staffId ?? undefined }))],
    existingBookings: [
      ...bookings.map(booking => ({ startAt: from(booking.startAt), endAt: from(booking.endAt), staffId: booking.staffId, serviceId: booking.serviceId,
        status: booking.status as "PENDING" | "CONFIRMED", quantity: booking.quantity, ...booking.service })),
      ...reservations.map(hold => ({ startAt: from(hold.startAt), endAt: from(hold.endAt), staffId: hold.staffId, serviceId: hold.serviceId,
        status: "PENDING" as const, quantity: hold.quantity, expiresAt: from(hold.expiresAt), ...hold.service })),
    ],
  });
  return { service, location, staff, shop, slots, displayTimezone, start, end };
}
export async function availabilityForDay(db: Database, shopId: string, serviceId: string, day: string, quantity: number, staffId?: string, excludeBookingId?: string, excludeReservationId?: string, now: DateTime = DateTime.utc(), enforceNotice = true, viewerTimezone?: string) {
  return availabilityForWindow(db, shopId, serviceId, day, quantity, staffId, excludeBookingId, excludeReservationId, now, enforceNotice, viewerTimezone);
}
export async function listDaySlots(shopId: string, serviceId: string, day: string, quantity = 1, staffId?: string, excludeBookingId?: string, viewerTimezone?: string, now: DateTime = DateTime.utc()) {
  const result = await availabilityForDay(getShopDatabase(shopId), shopId, serviceId, day, quantity, staffId, excludeBookingId, undefined, now, true, viewerTimezone);
  return { timezone: result.displayTimezone, capacity: result.service.capacity, slots: result.slots.map(slot => ({
    startAt: slot.startAt.toISO()!, endAt: slot.endAt.toISO()!, staffId: slot.staffId!, remaining: slot.remaining,
    label: slot.startAt.setZone(result.displayTimezone).toFormat("h:mm a ZZZZ"),
    staffName: result.staff.find(staff => staff.id === slot.staffId)?.firstName ?? "Availability",
  })) };
}
export async function listMonthAvailability(shopId: string, serviceId: string, month: string, quantity = 1, viewerTimezone?: string, now: DateTime = DateTime.utc()) {
  const first = DateTime.fromISO(month + "-01", { zone: "utc" });
  if (!/^\d{4}-\d{2}$/.test(month) || !first.isValid || first.toFormat("yyyy-MM") !== month) throw new BookingError("Choose a valid month.", 400);
  const result = await availabilityForWindow(getShopDatabase(shopId), shopId, serviceId, month + "-01", quantity, undefined, undefined, undefined, now, true, viewerTimezone, true);
  const available = new Set(result.slots.map(slot => slot.startAt.setZone(result.displayTimezone).toISODate()!));
  const days: { date: string; available: boolean }[] = [];
  for (let date = result.start; date < result.end; date = date.plus({ days: 1 })) days.push({ date: date.toISODate()!, available: available.has(date.toISODate()!) });
  return { timezone: result.displayTimezone, today: now.setZone(result.displayTimezone).toISODate()!,
    lastDate: now.setZone(result.location.timezone).plus({ days: result.service.maxAdvanceDays }).setZone(result.displayTimezone).toISODate()!, days };
}
// Per-day fill status for the merchant calendar, as booked minutes vs. working minutes across all
// active Availabilities — so days colour green (free) -> amber (filling up) -> red (full). Measured
// in staff working time so overlapping Events/Services sharing one Availability aren't double-counted.
export async function monthLoad(shopId: string, month: string, timezone: string, now: DateTime = DateTime.utc()): Promise<Record<string, DayLoad>> {
  if (!/^\d{4}-\d{2}$/.test(month)) return {};
  const db = getShopDatabase(shopId);
  const start = DateTime.fromISO(month + "-01", { zone: timezone }).startOf("month");
  const [staff, rules, bookings] = await Promise.all([
    db.staffMember.findMany({ where: { active: true }, select: { id: true, timezone: true } }),
    db.availabilityRule.findMany({ where: { staffId: { not: null } }, select: { staffId: true, weekday: true, startTime: true, endTime: true } }),
    db.booking.findMany({ where: { status: { in: ["CONFIRMED", "PENDING"] },
      startAt: { gte: start.toUTC().toJSDate(), lt: start.plus({ months: 1 }).toUTC().toJSDate() } }, select: { startAt: true, endAt: true } }),
  ]);
  const zoneFor = new Map(staff.map(person => [person.id, person.timezone || timezone]));
  const activeStaff = new Set(staff.map(person => person.id));
  const toMinutes = (time: string) => { const [h, m] = time.split(":").map(Number); return (h || 0) * 60 + (m || 0); };
  const working = new Map<string, number>();
  for (let d = start; d < start.plus({ months: 1 }); d = d.plus({ days: 1 })) {
    let total = 0;
    for (const rule of rules) {
      if (!rule.staffId || !activeStaff.has(rule.staffId)) continue;
      if (d.setZone(zoneFor.get(rule.staffId) || timezone).weekday % 7 !== rule.weekday) continue;
      total += Math.max(0, toMinutes(rule.endTime) - toMinutes(rule.startTime));
    }
    if (total > 0) working.set(d.toISODate()!, total);
  }
  const booked = new Map<string, number>();
  for (const booking of bookings) {
    const date = DateTime.fromJSDate(booking.startAt).setZone(timezone).toISODate();
    if (date) booked.set(date, (booked.get(date) ?? 0) + Math.max(0, Math.round((booking.endAt.getTime() - booking.startAt.getTime()) / 60000)));
  }
  const today = now.setZone(timezone).toISODate()!;
  const status: Record<string, DayLoad> = {};
  for (const date of new Set([...working.keys(), ...booked.keys()])) {
    const workMin = working.get(date) ?? 0, bookMin = booked.get(date) ?? 0;
    status[date] = dayLoadStatus(Math.max(0, workMin - bookMin), bookMin, date < today);
  }
  return status;
}
const waitlistInput = z.object({
  serviceId: z.string().min(1).max(100), staffId: z.string().min(1).max(100).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), email: z.string().trim().email().max(254),
});
export async function joinWaitlist(shopId: string, values: unknown, now: DateTime = DateTime.utc()) {
  const input = waitlistInput.parse(values);
  const db = getShopDatabase(shopId);
  const service = await db.service.findFirst({ where: { id: input.serviceId, active: true } });
  if (!service) throw new BookingError("Event/Service not found.", 404);
  const location = await db.location.findFirst({ where: { id: service.locationId, active: true } });
  if (!location) throw new BookingError("This location is not accepting bookings.", 404);
  if (input.staffId && !await db.serviceStaff.findFirst({ where: { serviceId: service.id, staffId: input.staffId } }))
    throw new BookingError("Choose an Availability assigned to this Event/Service.", 400);
  const day = DateTime.fromISO(input.date, { zone: location.timezone });
  if (!day.isValid || day.toISODate() !== input.date) throw new BookingError("Choose a calendar date that exists in this timezone.", 400);
  if (day.endOf("day") < now.setZone(location.timezone)) throw new BookingError("Choose a current or future date.", 400);
  return db.waitlistEntry.create({ data: { shopId, serviceId: service.id, staffId: input.staffId ?? null, customerEmail: input.email,
    desiredStart: day.startOf("day").toUTC().toJSDate(), desiredEnd: day.endOf("day").toUTC().toJSDate() } });
}
async function selection(db: Database, shopId: string, input: ReservationInput, now: DateTime, excludeBookingId?: string) {
  const service = await db.service.findFirst({ where: { id: input.serviceId, active: true } });
  if (!service) throw new BookingError("Event/Service not found.", 404);
  const location = await db.location.findFirst({ where: { id: service.locationId, active: true } });
  if (!location) throw new BookingError("Location not found.", 404);
  const day = DateTime.fromISO(input.startAt).setZone(location.timezone).toISODate()!;
  const result = await availabilityForDay(db, shopId, input.serviceId, day, input.quantity, input.staffId, excludeBookingId, undefined, now);
  const slot = result.slots.find(slot => slot.staffId === input.staffId && slot.startAt.toISO() === input.startAt);
  if (!slot) throw new BookingError("That time is no longer available. Please choose another time.");
  return { ...result, slot };
}
export async function createReservation(shopId: string, values: unknown, now: DateTime = DateTime.utc(), verifyVariant?: (id: string, cents: number) => Promise<void>) {
  const input = reservationInput.parse(values);
  const answers = z.object({ answers: customerInput.shape.answers }).parse(values).answers;
  const answerSnapshot = (items: typeof answers) => JSON.stringify([...items].sort((a, b) => a.questionId.localeCompare(b.questionId)));
  return withShopTransaction(shopId, async db => {
    const previous = await db.reservation.findUnique({ where: { shopId_idempotencyKey: { shopId, idempotencyKey: input.idempotencyKey } }, include: { booking: { select: { id: true } } } });
    if (previous) {
      if (!matchesReservation(previous, input) || previous.expiresAt <= now.toJSDate() || previous.booking) throw new BookingError("This reservation request has expired or was already used.");
      if (answerSnapshot(customerInput.shape.answers.parse(previous.answers ?? [])) !== answerSnapshot(answers)) throw new BookingError("This reservation has different intake answers. Retry with the original answers or choose again after it expires.", 409);
      if (previous.variantId && verifyVariant) await verifyVariant(previous.variantId, previous.priceCents);
      return previous;
    }
    const { service, slot, shop } = await selection(db, shopId, input, now);
    if (!service.variantId || service.priceCents === 0) throw new BookingError("Use the free booking form for this Event/Service.", 400);
    if (verifyVariant) await verifyVariant(service.variantId, service.priceCents);
    const questions = await db.intakeQuestion.findMany({ where: { serviceId: service.id, active: true } });
    for (const question of questions) {
      const answer = answers.find(item => item.questionId === question.id)?.value;
      if (question.required && !answer || answer && question.options.length && !question.options.includes(answer)) throw new BookingError("Please answer: " + question.label, 400);
    }
    if (new Set(answers.map(a => a.questionId)).size !== answers.length || answers.some(a => !questions.some(q => q.id === a.questionId))) throw new BookingError("Invalid intake answers.", 400);
    return db.reservation.create({ data: { shopId, serviceId: service.id, staffId: input.staffId, locationId: service.locationId,
      startAt: slot.startAt.toJSDate(), endAt: slot.endAt.toJSDate(), quantity: input.quantity, expiresAt: now.plus({ minutes: 15 }).toJSDate(),
      idempotencyKey: input.idempotencyKey, priceCents: service.priceCents, currency: shop.currency, depositType: service.depositType, dueCents: paymentDue(service), answers, variantId: ["FIXED", "PERCENT"].includes(service.depositType) ? null : service.variantId } });
  }, [input.staffId]);
}
export async function createBooking(shopId: string, values: unknown, customer: unknown, source: "free" | "manual", now: DateTime = DateTime.utc()) {
  const input = reservationInput.parse(values);
  const details = customerInput.parse(customer);
  return withShopTransaction(shopId, async db => {
    const previous = await db.booking.findUnique({ where: { shopId_idempotencyKey: { shopId, idempotencyKey: input.idempotencyKey } } });
    if (previous) {
      if (!matchesReservation(previous, input) || previous.customerEmail !== details.email || previous.source !== source) throw new BookingError("This booking request was already used.");
      return previous;
    }
    const { service, slot, staff, shop } = await selection(db, shopId, input, now);
    if (source === "free" && service.priceCents !== 0) throw new BookingError("Complete payment through Shopify checkout.", 400);
    const questions = await db.intakeQuestion.findMany({ where: { serviceId: service.id, active: true } });
    const answers = new Map(details.answers.map(answer => [answer.questionId, answer.value]));
    if (answers.size !== details.answers.length || details.answers.some(answer => !questions.some(question => question.id === answer.questionId))) throw new BookingError("Invalid intake answers.", 400);
    for (const question of questions) {
      const answer = answers.get(question.id);
      if (question.required && !answer) throw new BookingError("Please answer: " + question.label, 400);
      if (answer && question.options.length && !question.options.includes(answer)) throw new BookingError("Choose a valid answer for: " + question.label, 400);
    }
    const booking = await db.booking.create({ data: { shopId, serviceId: service.id, staffId: input.staffId, locationId: service.locationId,
      startAt: slot.startAt.toJSDate(), endAt: slot.endAt.toJSDate(), quantity: input.quantity, customerEmail: details.email, customerName: details.name,
      customerPhone: details.phone, notes: details.notes, status: "CONFIRMED", source, idempotencyKey: input.idempotencyKey,
      priceCents: service.priceCents, currency: shop.currency, contactLink: staff.find(s => s.id === input.staffId)?.contactLink } });
    if (details.answers.length) await db.intakeAnswer.createMany({ data: details.answers.map(answer => ({ ...answer, bookingId: booking.id })) });
    await queueBookingNotifications(db, shopId, booking, "CONFIRMATION", input.idempotencyKey, now);
    return booking;
  }, [input.staffId]);
}
export async function cancelBooking(shopId: string, bookingId: string, options: { customer?: boolean; now?: DateTime } = {}) {
  const db = getShopDatabase(shopId);
  const booking = await db.booking.findUnique({ where: { id: bookingId } });
  if (!booking) throw new BookingError("Booking not found.", 404);
  return withShopTransaction(shopId, async tx => {
    const current = await tx.booking.findUniqueOrThrow({ where: { id: bookingId } });
    if (options.customer) {
      if (current.status !== "CONFIRMED") throw new BookingError("This booking can no longer be cancelled by the customer.");
      const policy = await tx.service.findFirstOrThrow({ where: { id: current.serviceId }, select: { customerCancelCutoffHours: true, customerRescheduleCutoffHours: true } });
      const error = customerChangeError(DateTime.fromJSDate(current.startAt), policy, "cancel", options.now ?? DateTime.utc());
      if (error) throw new BookingError(error);
    }
    if (["COMPLETED", "NO_SHOW"].includes(current.status)) throw new BookingError("This appointment has already ended.");
    const cancelled = await tx.booking.update({ where: { id: bookingId, status: current.status, staffId: current.staffId, startAt: current.startAt }, data: { status: "CANCELLED" } }).catch(bookingMutationConflict);
    await queueBookingNotifications(tx, shopId, cancelled, "CANCELLED", "cancel");
    return cancelled;
  }, [booking.staffId]);
}
export async function rescheduleBooking(shopId: string, bookingId: string, values: unknown, now: DateTime = DateTime.utc(), merchantReview?: unknown, options: { customer?: boolean; now?: DateTime } = {}) {
  const input = reservationInput.parse(values);
  const booking = await getShopDatabase(shopId).booking.findUnique({ where: { id: bookingId } });
  if (!booking) throw new BookingError("Booking not found.", 404);
  return withShopTransaction(shopId, async tx => {
    const current = await tx.booking.findUniqueOrThrow({ where: { id: bookingId } });
    if (options.customer) {
      const policy = await tx.service.findFirstOrThrow({ where: { id: current.serviceId }, select: { customerCancelCutoffHours: true, customerRescheduleCutoffHours: true } });
      const error = customerChangeError(DateTime.fromJSDate(current.startAt), policy, "reschedule", options.now ?? DateTime.utc());
      if (error) throw new BookingError(error);
    }
    const reviewing = current.status === "NEEDS_REVIEW" && merchantReview !== undefined;
    const contact = reviewing ? customerInput.parse(merchantReview) : null;
    if ((!reviewing && current.status !== "CONFIRMED") || current.serviceId !== input.serviceId || current.quantity !== input.quantity) throw new BookingError("This booking cannot be rescheduled.");
    const { slot, staff } = await selection(tx, shopId, input, now, bookingId);
    const updated = await tx.booking.update({ where: { id: bookingId, status: current.status, staffId: current.staffId, startAt: current.startAt }, data: { status: "CONFIRMED", checkedInAt: null, checkedInBy: null, ...(contact ? { customerEmail: contact.email, customerName: contact.name } : {}), staffId: input.staffId, startAt: slot.startAt.toJSDate(), endAt: slot.endAt.toJSDate(),
      contactLink: staff.find(s => s.id === input.staffId)?.contactLink } }).catch(bookingMutationConflict);
    await queueBookingNotifications(tx, shopId, updated, reviewing ? "CONFIRMATION" : "RESCHEDULED", input.idempotencyKey, now);
    return updated;
  }, [booking.staffId, input.staffId]);
}

function bookingMutationConflict(error: unknown): never {
  if (error && typeof error === "object" && "code" in error && error.code === "P2025") {
    throw new BookingError("This booking changed while the request was processed. Please retry.");
  }
  throw error;
}
