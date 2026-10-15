import type { DateTime } from "luxon";
export interface Slot { startAt: DateTime; endAt: DateTime; staffId?: string; remaining: number }
export interface ServiceSpec {
  id?: string; slotIntervalMin?: number | null; durationMin: number; bufferBefore: number; bufferAfter: number;
  capacity: number; minNoticeHours: number; maxAdvanceDays: number;
}
export interface RuleSpec {
  weekday: number; // Sunday = 0
  startTime: string; endTime: string; timezone: string; staffId?: string;
}
export interface Interval { startAt: DateTime; endAt: DateTime; staffId?: string }
export interface AdditionalHoursSpec extends Interval { timezone: string }
export interface BookingSpec extends Interval {
  status: "PENDING" | "CONFIRMED"; serviceId?: string; quantity?: number;
  expiresAt?: DateTime; bufferBefore?: number; bufferAfter?: number;
}
export interface ComputeSlotsInput {
  service: ServiceSpec; timezone: string; rangeStart: DateTime; rangeEnd: DateTime;
  rules: RuleSpec[]; serviceRules?: RuleSpec[]; additionalHours?: AdditionalHoursSpec[]; blackouts: Interval[];
  existingBookings: BookingSpec[]; now: DateTime; staffIds?: string[]; quantity?: number;
}
