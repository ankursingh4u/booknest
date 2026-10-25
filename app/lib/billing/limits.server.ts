import { DateTime } from "luxon";
import type { Plan, Prisma } from "@prisma/client";
import { BookingError } from "../bookings/validation";
import { limitMessage, planAllows, withinCatalogLimit, withinMonthlyBookings, type CatalogKind, type PlanFeature } from "./limits";
type Database = Pick<Prisma.TransactionClient, "shop" | "service" | "staffMember" | "booking">;
// Plan limits bite only once billing is live; until then every store behaves as unlimited,
// so development stores and existing merchants are unaffected by the rollout order.
export function planEnforcementActive() {
  return process.env.BILLING_ENFORCEMENT === "true";
}
async function shopPlan(db: Database, shopId: string): Promise<Plan> {
  return (await db.shop.findUniqueOrThrow({ where: { id: shopId }, select: { plan: true } })).plan;
}
export function featureAllowed(plan: Plan, feature: PlanFeature) {
  return !planEnforcementActive() || planAllows(plan, feature);
}
export function requireFeature(plan: Plan, feature: PlanFeature) {
  if (!featureAllowed(plan, feature)) throw new BookingError(limitMessage(feature), 403);
}
export async function requireCatalogCapacity(db: Database, shopId: string, kind: CatalogKind) {
  if (!planEnforcementActive()) return;
  const plan = await shopPlan(db, shopId);
  const count = kind === "services" ? await db.service.count({ where: { active: true } }) : await db.staffMember.count({ where: { active: true } });
  if (!withinCatalogLimit(plan, kind, count)) throw new BookingError(limitMessage(kind), 403);
}
export async function requireBookingCapacity(db: Database, shopId: string, now: DateTime = DateTime.utc()) {
  if (!planEnforcementActive()) return;
  const plan = await shopPlan(db, shopId);
  const count = await db.booking.count({ where: { status: { not: "CANCELLED" }, createdAt: { gte: now.startOf("month").toJSDate() } } });
  if (!withinMonthlyBookings(plan, count)) throw new BookingError(limitMessage("bookings"), 403);
}
