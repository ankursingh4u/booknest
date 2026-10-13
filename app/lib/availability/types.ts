import type { DateTime } from "luxon";

/** A bookable slot, always in UTC. */
export interface Slot {
  startAt: DateTime;
  endAt: DateTime;
  staffId?: string;
  remaining: number;
}

export interface ServiceSpec {
  durationMin: number;
  bufferBefore: number;
  bufferAfter: number;
  capacity: number;
  minNoticeHours: number;
  maxAdvanceDays: number;
}

export interface RuleSpec {
  weekday: number;   // 0 = Sunday .. 6 = Saturday
  startTime: string; // "09:00" local to `timezone`
  endTime: string;   // "17:00" local to `timezone`
  timezone: string;
  staffId?: string;
}

export interface Interval {
  startAt: DateTime;
  endAt: DateTime;
  staffId?: string;
}

export interface BookingSpec {
  startAt: DateTime;
  endAt: DateTime;
  status: "PENDING" | "CONFIRMED";
  staffId?: string;
}

export interface ComputeSlotsInput {
  service: ServiceSpec;
  timezone: string;
  rangeStart: DateTime;
  rangeEnd: DateTime;
  rules: RuleSpec[];
  blackouts: Interval[];
  existingBookings: BookingSpec[];
  now: DateTime;
  staffIds?: string[];
}
