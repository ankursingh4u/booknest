import { describe, expect, it } from "vitest";
import { planAllows, withinCatalogLimit, withinMonthlyBookings, limitMessage } from "./limits";
describe("catalog limits", () => {
  it("caps Free at one Event/Service and one Availability", () => {
    expect(withinCatalogLimit("FREE", "services", 0)).toBe(true);
    expect(withinCatalogLimit("FREE", "services", 1)).toBe(false);
    expect(withinCatalogLimit("FREE", "availabilities", 1)).toBe(false);
  });
  it("caps Standard at three Availabilities with unlimited Events/Services", () => {
    expect(withinCatalogLimit("STANDARD", "availabilities", 2)).toBe(true);
    expect(withinCatalogLimit("STANDARD", "availabilities", 3)).toBe(false);
    expect(withinCatalogLimit("STANDARD", "services", 500)).toBe(true);
  });
  it("leaves Pro and Pro Plus unlimited", () => {
    expect(withinCatalogLimit("PRO", "availabilities", 500)).toBe(true);
    expect(withinCatalogLimit("PRO_PLUS", "services", 500)).toBe(true);
  });
});
describe("monthly booking cap", () => {
  it("caps Free at 20 bookings per month and leaves paid plans unlimited", () => {
    expect(withinMonthlyBookings("FREE", 19)).toBe(true);
    expect(withinMonthlyBookings("FREE", 20)).toBe(false);
    expect(withinMonthlyBookings("STANDARD", 10000)).toBe(true);
  });
});
describe("plan features", () => {
  it("grants Google Calendar, intake, and insights from Pro", () => {
    for (const feature of ["googleCalendar", "intake", "insights"] as const) {
      expect(planAllows("FREE", feature)).toBe(false);
      expect(planAllows("STANDARD", feature)).toBe(false);
      expect(planAllows("PRO", feature)).toBe(true);
      expect(planAllows("PRO_PLUS", feature)).toBe(true);
    }
  });
  it("reserves the Team Portal for Pro Plus", () => {
    expect(planAllows("PRO", "teamPortal")).toBe(false);
    expect(planAllows("PRO_PLUS", "teamPortal")).toBe(true);
  });
});
describe("limit messages", () => {
  it("names the limit and points at upgrading", () => {
    expect(limitMessage("services")).toMatch(/plan/i);
    expect(limitMessage("googleCalendar")).toMatch(/upgrade/i);
  });
});
