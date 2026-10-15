import { DateTime } from "luxon";
export type CustomerChangeIntent = "cancel" | "reschedule";
export interface CustomerChangePolicy {
  customerCancelCutoffHours?: number;
  customerRescheduleCutoffHours?: number;
}
/** Returns customer-facing rejection text, or null while changes remain open. */
export function customerChangeError(startAt: DateTime, policy: CustomerChangePolicy, intent: CustomerChangeIntent, now: DateTime = DateTime.utc()): string | null {
  const cutoff = (intent === "cancel" ? policy.customerCancelCutoffHours : policy.customerRescheduleCutoffHours) ?? 0;
  if (!startAt.isValid || !now.isValid || !Number.isInteger(cutoff) || cutoff < 0 || cutoff > 8760) {
    return "Booking changes cannot be verified. Please contact the store.";
  }
  if (now.toMillis() >= startAt.toMillis()) return "This appointment has already started. Please contact the store.";
  if (now.toMillis() >= startAt.toUTC().minus({ hours: cutoff }).toMillis()) {
    return (intent === "cancel" ? "Cancellation" : "Rescheduling") + " closes " + cutoff + " " + (cutoff === 1 ? "hour" : "hours") + " before the appointment. Please contact the store.";
  }
  return null;
}
