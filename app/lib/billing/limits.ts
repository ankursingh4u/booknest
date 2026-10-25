import type { Plan } from "@prisma/client";
export type PlanFeature = "googleCalendar" | "intake" | "insights" | "teamPortal";
export type CatalogKind = "services" | "availabilities";
const unlimited = Number.POSITIVE_INFINITY;
export const planLimits: Record<Plan, { services: number; availabilities: number; bookingsPerMonth: number; features: Record<PlanFeature, boolean> }> = {
  FREE: { services: 1, availabilities: 1, bookingsPerMonth: 20, features: { googleCalendar: false, intake: false, insights: false, teamPortal: false } },
  STANDARD: { services: unlimited, availabilities: 3, bookingsPerMonth: unlimited, features: { googleCalendar: false, intake: false, insights: false, teamPortal: false } },
  PRO: { services: unlimited, availabilities: unlimited, bookingsPerMonth: unlimited, features: { googleCalendar: true, intake: true, insights: true, teamPortal: false } },
  PRO_PLUS: { services: unlimited, availabilities: unlimited, bookingsPerMonth: unlimited, features: { googleCalendar: true, intake: true, insights: true, teamPortal: true } },
};
export function planAllows(plan: Plan, feature: PlanFeature) {
  return planLimits[plan].features[feature];
}
export function withinCatalogLimit(plan: Plan, kind: CatalogKind, currentCount: number) {
  return currentCount < planLimits[plan][kind];
}
export function withinMonthlyBookings(plan: Plan, countThisMonth: number) {
  return countThisMonth < planLimits[plan].bookingsPerMonth;
}
const names: Record<CatalogKind | PlanFeature | "bookings", string> = {
  services: "Your plan's Event/Service limit is reached.",
  availabilities: "Your plan's Availability limit is reached.",
  bookings: "This store reached its plan's monthly booking limit. New bookings open again next month.",
  googleCalendar: "Google Calendar sync is available on the Pro plan and above.",
  intake: "Intake questions are available on the Pro plan and above.",
  insights: "Booking insights and exports are available on the Pro plan and above.",
  teamPortal: "The Team Portal is available on the Pro Plus plan.",
};
export function limitMessage(subject: CatalogKind | PlanFeature | "bookings") {
  // The booking cap is shown to shoppers on the storefront; the rest address the merchant.
  if (subject === "bookings") return names[subject];
  return names[subject] + " Upgrade in Account and plan to continue.";
}
