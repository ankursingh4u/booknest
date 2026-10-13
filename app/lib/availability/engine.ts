/**
 * Pure availability engine. No DB, no fetch, no side effects.
 *
 * Algorithm:
 *   1. expandRules   -> concrete local datetimes, DST-safe, converted to UTC
 *   2. subtract blackouts
 *   3. subtract existing bookings plus buffers
 *   4. drop slots inside minNoticeHours, drop beyond maxAdvanceDays
 *   5. apply capacity -> remaining
 *   6. return UTC slots
 *
 * See docs/decisions/0001-availability-engine.md and BUILD_GUIDE Phase 3.
 */
import type { ComputeSlotsInput, Slot } from "./types";

export function computeSlots(input: ComputeSlotsInput): Slot[] {
  const { rules, timezone, rangeStart, rangeEnd, blackouts, existingBookings, now } = input;
  void rules; void timezone; void rangeStart; void rangeEnd;
  void blackouts; void existingBookings; void now;
  return [];
}

/** Expand weekly recurring rules into concrete UTC intervals. DST-safe. */
export function expandRules(input: ComputeSlotsInput): Slot[] {
  void input;
  return [];
}
