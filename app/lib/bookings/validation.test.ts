import { describe, expect, it } from "vitest";
import { reservationInput, customerInput, matchesReservation } from "./validation";
describe("booking input and replay protection", () => {
  const value = { serviceId: "service", staffId: "staff", startAt: "2026-10-20T09:00:00Z", quantity: 2, idempotencyKey: "8adf23e1-653e-4ac4-8db7-e0cfe5350c28" };
  it("requires an explicit timezone offset", () => { expect(reservationInput.safeParse({ ...value, startAt: "2026-10-20T09:00" }).success).toBe(false); });
  it("rejects a zero or fractional party size", () => {
    expect(reservationInput.safeParse({ ...value, quantity: 0 }).success).toBe(false);
    expect(reservationInput.safeParse({ ...value, quantity: 1.2 }).success).toBe(false);
  });
  it("requires customer contact details", () => { expect(customerInput.safeParse({ email: "invalid", name: "" }).success).toBe(false); });
  it("binds idempotency to service, staff, time, and party size", () => {
    const input = reservationInput.parse(value);
    const record = { ...input, startAt: new Date(input.startAt) };
    expect(matchesReservation(record, input)).toBe(true);
    expect(matchesReservation(record, { ...input, serviceId: "other" })).toBe(false);
    expect(matchesReservation(record, { ...input, quantity: 3 })).toBe(false);
  });
});
