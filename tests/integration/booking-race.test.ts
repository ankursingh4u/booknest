import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";
// Requires a disposable, migrated database explicitly named booknest_test.
// Never falls back to DATABASE_URL from the development/production environment.
const testUrl = process.env.BOOKNEST_TEST_DATABASE_URL;
describe.skipIf(!testUrl)("PostgreSQL booking concurrency", () => {
  let shopId: string, staffId: string, serviceId: string, startAt: string;
  let dbModule: typeof import("../../app/db.server");
  let bookings: typeof import("../../app/lib/bookings/service.server");
  beforeAll(async () => {
    const url = new URL(testUrl!);
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !/^\/booknest_test(?:_[a-z0-9_]+)?$/.test(url.pathname)) throw new Error("Use an isolated booknest_test database.");
    vi.stubEnv("DATABASE_URL", testUrl!); vi.stubEnv("DIRECT_URL", testUrl!);
    dbModule = await import("../../app/db.server"); bookings = await import("../../app/lib/bookings/service.server");
    const shop = await dbModule.syncShopIdentity({ shop: "race-" + randomUUID() + ".myshopify.com", accessToken: "integration-only", isOnline: false });
    shopId = shop!.id;
    const db = dbModule.getShopDatabase(shopId);
    const location = await db.location.create({ data: { shopId, name: "Test", timezone: "UTC" } });
    const staff = await db.staffMember.create({ data: { shopId, firstName: "Race", lastName: "Test", email: "race@example.test", timezone: "UTC", locationIds: [location.id] } });
    staffId = staff.id;
    const day = DateTime.utc().plus({ days: 2 }).startOf("day"); startAt = day.set({ hour: 9 }).toISO()!;
    await db.availabilityRule.create({ data: { shopId, staffId, weekday: day.weekday % 7, startTime: "09:00", endTime: "12:00", timezone: "UTC" } });
    await dbModule.withShopTransaction(shopId, async tx => {
      const service = await tx.service.create({ data: { shopId, locationId: location.id, title: "Race test", slug: "race", durationMin: 60, capacity: 3,
        priceCents: 1000, variantId: "gid://shopify/ProductVariant/1", minNoticeHours: 0 } });
      serviceId = service.id;
      await tx.serviceStaff.create({ data: { serviceId, staffId } });
    });
  }, 30000);
  afterAll(async () => { if (shopId) await dbModule.purgeShopData(shopId); vi.unstubAllEnvs(); });
  it("20 competing holds never exceed three seats", async () => {
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => bookings.createReservation(shopId, { serviceId, staffId, startAt, quantity: 1, idempotencyKey: randomUUID() })));
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(3);
    const rows = await dbModule.getShopDatabase(shopId).reservation.findMany();
    expect(rows.reduce((sum, row) => sum + row.quantity, 0)).toBe(3);
  }, 60000);
  it("20 retries of one manual booking create one booking and one confirmation", async () => {
    const later = DateTime.fromISO(startAt).plus({ hours: 2 }).toISO()!;
    const input = { serviceId, staffId, startAt: later, quantity: 1, idempotencyKey: randomUUID() };
    const results = await Promise.all(Array.from({ length: 20 }, () => bookings.createBooking(shopId, input, { email: "customer@example.test", name: "Test customer" }, "manual")));
    expect(new Set(results.map(row => row.id)).size).toBe(1);
    expect(await dbModule.getShopDatabase(shopId).notificationTask.count({ where: { bookingId: results[0]!.id, kind: "CONFIRMATION" } })).toBe(1);
  }, 60000);
});
