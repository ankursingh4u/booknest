import { describe, it, expect } from "vitest";
import { setupSteps, setupError } from "./setup";

describe("onboarding setup checklist", () => {
  it("lists only store preferences and service creation — no manual location, Availability, or hours steps", () => {
    const steps = setupSteps({ email: "owner@example.com", services: 0 });
    expect(steps.map(step => step.title)).toEqual(["Confirm store preferences", "Create your first Event/Service"]);
    expect(steps.some(step => /location|availabilit|working hours/i.test(step.title))).toBe(false);
  });
  it("marks each step done from its backing data", () => {
    expect(setupSteps({ email: null, services: 3 })).toMatchObject([{ done: false }, { done: true }]);
    expect(setupSteps({ email: "a@b.com", services: 0 })).toMatchObject([{ done: true }, { done: false }]);
  });
  it("gates finishing on email, a service, and a tested booking — not on locations or staff counts", () => {
    expect(setupError({ email: null, services: 1, tested: true })).toMatch(/reply email/);
    expect(setupError({ email: "a@b.com", services: 0, tested: true })).toMatch(/Event\/Service/);
    expect(setupError({ email: "a@b.com", services: 1, tested: false })).toMatch(/Test a storefront/);
    expect(setupError({ email: "a@b.com", services: 1, tested: true })).toBeNull();
  });
});
