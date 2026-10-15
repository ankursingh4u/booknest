import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { customerChangeError } from "./policy";
const utc = (value: string) => DateTime.fromISO(value, { zone: "utc" });
describe("customer change policy", () => {
  it("allows changes before the configured deadline", () => {
    expect(customerChangeError(utc("2026-03-02T10:00Z"), { customerCancelCutoffHours: 2 }, "cancel", utc("2026-03-02T07:59:59Z"))).toBeNull();
  });
  it("closes cancellation at its cutoff without closing rescheduling", () => {
    const policy = { customerCancelCutoffHours: 2, customerRescheduleCutoffHours: 1 };
    expect(customerChangeError(utc("2026-03-02T10:00Z"), policy, "cancel", utc("2026-03-02T08:00Z"))).toMatch(/Cancellation.*2 hours/);
    expect(customerChangeError(utc("2026-03-02T10:00Z"), policy, "reschedule", utc("2026-03-02T08:00Z"))).toBeNull();
  });
  it("uses elapsed hours across DST rather than local clock subtraction", () => {
    const start = DateTime.fromISO("2026-03-08T03:30", { zone: "America/New_York" });
    const before = DateTime.fromISO("2026-03-08T01:29:59", { zone: "America/New_York" });
    const deadline = DateTime.fromISO("2026-03-08T01:30", { zone: "America/New_York" });
    expect(customerChangeError(start, { customerRescheduleCutoffHours: 1 }, "reschedule", before)).toBeNull();
    expect(customerChangeError(start, { customerRescheduleCutoffHours: 1 }, "reschedule", deadline)).toMatch(/Rescheduling.*1 hour/);
  });
  it("defaults absent policies to allowing changes until appointment start", () => {
    const start = utc("2026-03-02T10:00Z");
    expect(customerChangeError(start, {}, "cancel", utc("2026-03-02T09:59:59Z"))).toBeNull();
    expect(customerChangeError(start, {}, "reschedule", start)).toMatch(/already started/);
    expect(customerChangeError(start, {}, "cancel", utc("2026-03-02T11:00Z"))).toMatch(/already started/);
  });
  it("rejects invalid clocks or policy values", () => {
    expect(customerChangeError(DateTime.invalid("bad date"), {}, "cancel", utc("2026-03-02T08:00Z"))).toMatch(/contact the store/);
    for (const cutoff of [-1, 0.5, 8761, NaN]) {
      expect(customerChangeError(utc("2026-03-02T10:00Z"), { customerCancelCutoffHours: cutoff }, "cancel", utc("2026-03-02T08:00Z"))).not.toBeNull();
    }
  });
});
