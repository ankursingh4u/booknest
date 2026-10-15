import { DateTime, IANAZone } from "luxon";
import type { ComputeSlotsInput, RuleSpec, Slot } from "./types";

const minuteOfDay = (value: string) => {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error("Invalid schedule time");
  const [hour, minute] = value.split(":").map(Number);
  return hour! * 60 + minute!;
};
const overlaps = (a: number, b: number, c: number, d: number) => a < d && c < b;

function validate(input: ComputeSlotsInput) {
  const { service: s, rangeStart, rangeEnd, now } = input;
  if (![rangeStart, rangeEnd, now].every(d => d.isValid) || rangeEnd <= rangeStart
    || rangeEnd.diff(rangeStart, "days").days > 93) throw new Error("Invalid or excessive date range");
  if (!IANAZone.isValidZone(input.timezone)) throw new Error("Invalid timezone");
  if (![s.durationMin, s.capacity].every(n => Number.isInteger(n) && n > 0)
    || s.durationMin > 1440 || s.capacity > 10000
    || ![s.bufferBefore, s.bufferAfter, s.minNoticeHours, s.maxAdvanceDays].every(n => Number.isFinite(n) && n >= 0)
    || s.bufferBefore > 1440 || s.bufferAfter > 1440) throw new Error("Invalid service schedule");
  if (s.slotIntervalMin != null && (!Number.isInteger(s.slotIntervalMin) || s.slotIntervalMin < 1 || s.slotIntervalMin > 1440)) throw new Error("Invalid slot interval");
  if (!Number.isInteger(input.quantity ?? 1) || (input.quantity ?? 1) < 1) throw new Error("Invalid party size");
  if (input.rules.length + (input.serviceRules?.length ?? 0) + (input.additionalHours?.length ?? 0) > 1000) throw new Error("Too many schedule rules");
  for (const rule of [...input.rules, ...(input.serviceRules ?? [])]) {
    if (!Number.isInteger(rule.weekday) || rule.weekday < 0 || rule.weekday > 6
      || !IANAZone.isValidZone(rule.timezone) || minuteOfDay(rule.startTime) === minuteOfDay(rule.endTime)) {
      throw new Error("Invalid availability rule");
    }
  }
  for (const addition of input.additionalHours ?? []) {
    if (!addition.startAt.isValid || !addition.endAt.isValid || addition.endAt <= addition.startAt
      || addition.endAt.diff(addition.startAt, "hours").hours > 26 || !IANAZone.isValidZone(addition.timezone)
      || addition.startAt.second || addition.startAt.millisecond || addition.endAt.second || addition.endAt.millisecond) throw new Error("Invalid additional opening hours");
    const localStart = addition.startAt.setZone(addition.timezone);
    const localEnd = addition.endAt.setZone(addition.timezone);
    const wallMinutes = localEnd.startOf("day").diff(localStart.startOf("day"), "days").days * 1440 + localEnd.hour * 60 + localEnd.minute - localStart.hour * 60 - localStart.minute;
    if (wallMinutes <= 0 || wallMinutes > 1440) throw new Error("Invalid additional opening hours");
  }
  for (const interval of [...input.blackouts, ...input.existingBookings]) {
    if (!interval.startAt.isValid || !interval.endAt.isValid || interval.endAt <= interval.startAt) throw new Error("Invalid occupied interval");
  }
}

/** Construct wall time without silently shifting spring-forward gaps. */
function wallTime(day: DateTime, minute: number): DateTime {
  const date = day.plus({ days: Math.floor(minute / 1440) });
  const time = minute % 1440;
  return DateTime.fromObject({ year: date.year, month: date.month, day: date.day,
    hour: Math.floor(time / 60), minute: time % 60 }, { zone: day.zoneName! });
}
function windows(rule: RuleSpec, input: ComputeSlotsInput) {
  const intervals: { day: DateTime; startMinute: number; endMinute: number; start: number; end: number }[] = [];
  let day = input.rangeStart.setZone(rule.timezone).startOf("day").minus({ days: 1 });
  const lastDay = input.rangeEnd.setZone(rule.timezone).startOf("day");
  const startMinute = minuteOfDay(rule.startTime);
  let endMinute = minuteOfDay(rule.endTime);
  if (endMinute < startMinute) endMinute += 1440;
  for (; day <= lastDay; day = day.plus({ days: 1 })) {
    if (day.weekday % 7 !== rule.weekday) continue;
    const starts = wallTime(day, startMinute).getPossibleOffsets().map(d => d.toMillis());
    const ends = wallTime(day, endMinute).getPossibleOffsets().map(d => d.toMillis());
    intervals.push({ day, startMinute, endMinute, start: Math.min(...starts), end: Math.max(...ends) });
  }
  return intervals;
}

type OpeningWindow = ReturnType<typeof windows>[number];
function mergeWindows(windows: { start: number; end: number }[]) {
  const merged: { start: number; end: number }[] = [];
  for (const interval of [...windows].sort((a, b) => a.start - b.start || a.end - b.end)) {
    const previous = merged.at(-1);
    if (previous && interval.start <= previous.end) previous.end = Math.max(previous.end, interval.end);
    else merged.push({ start: interval.start, end: interval.end });
  }
  return merged;
}

/** Expand recurring and explicitly added wall-clock hours into UTC candidates. */
export function expandRules(input: ComputeSlotsInput): Slot[] {
  validate(input);
  const { service: s } = input;
  const slots = new Map<string, Slot>();
  const byStaff = new Map<string | undefined, OpeningWindow[]>();
  const append = (staffId: string | undefined, window: OpeningWindow) => {
    if (staffId && input.staffIds && !input.staffIds.includes(staffId)) return;
    const list = byStaff.get(staffId) ?? []; list.push(window); byStaff.set(staffId, list);
  };
  for (const rule of input.rules) {
    for (const staffId of rule.staffId ? [rule.staffId] : input.staffIds ?? [undefined]) {
      for (const window of windows(rule, input)) append(staffId, window);
    }
  }
  for (const addition of input.additionalHours ?? []) {
    const start = addition.startAt.setZone(addition.timezone);
    const end = addition.endAt.setZone(addition.timezone);
    const day = start.startOf("day");
    const window = { day, startMinute: start.hour * 60 + start.minute,
      endMinute: end.startOf("day").diff(day, "days").days * 1440 + end.hour * 60 + end.minute,
      start: addition.startAt.toMillis(), end: addition.endAt.toMillis() };
    for (const staffId of addition.staffId ? [addition.staffId] : input.staffIds ?? [undefined]) append(staffId, window);
  }
  for (const [staffId, windows] of byStaff) {
    const combined = mergeWindows(windows);
    for (const window of windows) {
      for (let minute = window.startMinute; minute < window.endMinute; minute += s.slotIntervalMin ?? s.durationMin) {
        const wall = wallTime(window.day, minute);
        if (wall.hour * 60 + wall.minute !== minute % 1440) continue;
        for (const localStart of wall.getPossibleOffsets()) {
          const startAt = localStart.toUTC();
          const endAt = startAt.plus({ minutes: s.durationMin });
          const occupiedStart = startAt.minus({ minutes: s.bufferBefore }).toMillis();
          const occupiedEnd = endAt.plus({ minutes: s.bufferAfter }).toMillis();
          if (startAt < input.rangeStart || startAt >= input.rangeEnd
            || startAt.toMillis() < window.start || startAt.toMillis() >= window.end
            || !combined.some(opening => occupiedStart >= opening.start && occupiedEnd <= opening.end)) continue;
          slots.set((staffId ?? "") + ":" + startAt.toMillis(), { startAt, endAt, staffId, remaining: s.capacity });
        }
      }
    }
  }
  return [...slots.values()].sort((a, b) => a.startAt.toMillis() - b.startAt.toMillis() || (a.staffId ?? "").localeCompare(b.staffId ?? ""));
}

/** Pure scheduling: injected clock, no persistence and no network calls. */
export function computeSlots(input: ComputeSlotsInput): Slot[] {
  const candidates = expandRules(input);
  const { service: s } = input;
  const earliest = input.now.toUTC().plus({ hours: s.minNoticeHours });
  const latest = input.now.setZone(input.timezone).plus({ days: s.maxAdvanceDays });
  const serviceWindows = input.serviceRules?.flatMap(rule => windows(rule, input));
  return candidates.filter(slot => {
    if (slot.startAt < earliest || slot.startAt > latest) return false;
    const start = slot.startAt.minus({ minutes: s.bufferBefore }).toMillis();
    const end = slot.endAt.plus({ minutes: s.bufferAfter }).toMillis();
    if (serviceWindows?.length === 0 && input.serviceRules?.length) return false;
    if (serviceWindows?.length && !serviceWindows.some(window => start >= window.start && end <= window.end)) return false;
    if (input.blackouts.some(b => (!b.staffId || b.staffId === slot.staffId)
      && overlaps(start, end, b.startAt.toMillis(), b.endAt.toMillis()))) return false;
    let occupied = 0;
    for (const booking of input.existingBookings) {
      if (booking.staffId && booking.staffId !== slot.staffId) continue;
      if (booking.status === "PENDING" && booking.expiresAt && booking.expiresAt <= input.now) continue;
      const otherStart = booking.startAt.minus({ minutes: booking.bufferBefore ?? s.bufferBefore }).toMillis();
      const otherEnd = booking.endAt.plus({ minutes: booking.bufferAfter ?? s.bufferAfter }).toMillis();
      if (!overlaps(start, end, otherStart, otherEnd)) continue;
      const sameGroup = booking.serviceId === s.id && booking.startAt.toMillis() === slot.startAt.toMillis() && booking.endAt.toMillis() === slot.endAt.toMillis();
      if (!sameGroup) return false;
      occupied += booking.quantity ?? 1;
    }
    slot.remaining = s.capacity - occupied;
    return slot.remaining >= (input.quantity ?? 1);
  });
}
