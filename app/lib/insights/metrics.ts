import { z } from "zod";
type Group = { status: string; currency: string; quantity: number; _count: { _all: number }; _sum: { priceCents: number | null; paidCents: number | null } };
export function summarizeMetrics(groups: Group[]) {
  const status: Record<string, number> = {};
  const money: Record<string, { bookedCents: number; recordedPaymentsCents: number }> = {};
  let bookings = 0, guests = 0;
  for (const group of groups) {
    const count = group._count._all;
    bookings += count; guests += count * group.quantity; status[group.status] = (status[group.status] ?? 0) + count;
    const entry = money[group.currency] ??= { bookedCents: 0, recordedPaymentsCents: 0 };
    if (["CONFIRMED", "COMPLETED", "NO_SHOW"].includes(group.status)) entry.bookedCents += (group._sum.priceCents ?? 0) * group.quantity;
    entry.recordedPaymentsCents += group._sum.paidCents ?? 0;
  }
  const attended = (status.COMPLETED ?? 0) + (status.NO_SHOW ?? 0);
  return { bookings, guests, status, money,
    noShowRate: attended ? Math.round((status.NO_SHOW ?? 0) / attended * 1000) / 10 : 0,
    cancellationRate: bookings ? Math.round((status.CANCELLED ?? 0) / bookings * 1000) / 10 : 0 };
}
export type Metrics = ReturnType<typeof summarizeMetrics>;
export function baselineInsights(current: Metrics, previous: Metrics) {
  const delta = current.bookings - previous.bookings;
  return {
    highlights: [
      current.bookings + " bookings scheduled in the last 30 days.",
      (delta >= 0 ? delta + " more" : Math.abs(delta) + " fewer") + " than the preceding 30 days.",
      (current.status.CANCELLED ?? 0) + " cancellations and " + (current.status.NO_SHOW ?? 0) + " no-shows.",
    ],
    nudge: current.bookings === 0 ? "Create your first Event/Service and enable the booking widget."
      : (current.status.NEEDS_REVIEW ?? 0) > 0 ? "Review paid bookings that need attention before accepting more appointments."
      : current.noShowRate >= 10 ? "Review reminder emails and keep check-in records up to date."
      : "Review your busiest Events/Services before adjusting working hours.",
  };
}
const insightSchema = z.object({ highlights: z.array(z.string().trim().min(1).max(300)).min(1).max(3), nudge: z.string().trim().min(1).max(400) }).strict();
export function parseInsight(text: string) { return insightSchema.parse(JSON.parse(text)); }
