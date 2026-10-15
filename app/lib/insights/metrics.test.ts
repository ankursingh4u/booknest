import { describe, expect, it } from "vitest";
import { summarizeMetrics, baselineInsights, parseInsight } from "./metrics";
describe("booking metrics", () => {
  it("multiplies per-seat value and preserves currency boundaries", () => {
    const metrics = summarizeMetrics([
      { status: "COMPLETED", currency: "USD", quantity: 3, _count: { _all: 2 }, _sum: { priceCents: 2000, paidCents: 4500 } },
      { status: "CANCELLED", currency: "USD", quantity: 1, _count: { _all: 1 }, _sum: { priceCents: 1000, paidCents: 1000 } },
      { status: "CONFIRMED", currency: "EUR", quantity: 1, _count: { _all: 1 }, _sum: { priceCents: 500, paidCents: 0 } },
    ]);
    expect(metrics.bookings).toBe(4); expect(metrics.guests).toBe(8);
    expect(metrics.money.USD).toEqual({ bookedCents: 6000, recordedPaymentsCents: 5500 });
    expect(metrics.money.EUR?.bookedCents).toBe(500);
    expect(metrics.cancellationRate).toBe(25);
  });
  it("avoids division by zero and offers setup guidance with no data", () => {
    const empty = summarizeMetrics([]);
    expect(empty.noShowRate).toBe(0); expect(empty.cancellationRate).toBe(0);
    expect(baselineInsights(empty, empty).nudge).toContain("first");
  });
  it("validates model output before displaying it", () => {
    expect(parseInsight('{"highlights":["Bookings rose."],"nudge":"Review working hours."}')).toEqual({ highlights: ["Bookings rose."], nudge: "Review working hours." });
    expect(() => parseInsight('{"highlights":[],"nudge":"ok"}')).toThrow();
    expect(() => parseInsight("not json")).toThrow();
  });
});
