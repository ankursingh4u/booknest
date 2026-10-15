import { expect, it } from "vitest";
import { paymentDue, reservationProperties } from "./checkout";
it("calculates full, fixed and percentage deposits in integer cents", () => {
  expect(paymentDue({ priceCents: 2500, depositType: "NONE", depositValue: 0 })).toBe(2500);
  expect(paymentDue({ priceCents: 2500, depositType: "FIXED", depositValue: 500 })).toBe(500);
  expect(paymentDue({ priceCents: 1001, depositType: "PERCENT", depositValue: 25 })).toBe(250);
});
it("rejects a deposit exceeding the price", () => {
  expect(() => paymentDue({ priceCents: 500, depositType: "FIXED", depositValue: 600 })).toThrow();
});
it("generates reservation properties exclusively from stored values", () => {
  const properties = reservationProperties({ id: "hold", serviceId: "service", startAt: new Date("2026-10-20T09:00Z"), endAt: new Date("2026-10-20T10:00Z"), expiresAt: new Date("2026-10-19T09:15Z") }, "Asia/Kolkata", "Alex");
  expect(properties["_BookNest Reservation"]).toBe("hold");
  expect(properties["_Start Time"]).toBe("2:30 PM");
  expect(properties["_Booking Timezone"]).toBe("Asia/Kolkata");
});
