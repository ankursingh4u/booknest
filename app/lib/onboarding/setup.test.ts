import { describe, it, expect } from "vitest";
import { setupSteps } from "./setup";

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
});
