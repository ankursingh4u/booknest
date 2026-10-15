import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { DateTime } from "luxon";
const state = vi.hoisted(() => ({ tx: {} as Record<string, any> }));
vi.mock("../../db.server", () => ({ getShopDatabase: () => state.tx }));
import { queueSeatUsage, submitSeatUsage } from "./seats.server";
const now = DateTime.fromISO("2026-10-15T12:00Z");
beforeEach(() => {
  vi.stubEnv("TEAM_SEAT_BILLING_ENABLED", "true"); vi.stubEnv("SHOPIFY_TEAM_SEAT_METER_HANDLE", "team-seat-month");
  state.tx = {
    subscription: { findUnique: vi.fn().mockResolvedValue({ status: "ACTIVE", shopifyShopGid: "gid://shopify/Shop/1", seatMeterActive: true, currentPeriodStart: new Date("2026-10-01T00:00Z"), currentPeriodEnd: new Date("2026-11-01T00:00Z") }) },
    teamSeat: { findMany: vi.fn().mockResolvedValue([{ id: "seat" }]) },
    seatUsage: { createMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  };
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("team seat billing", () => {
  it("queues one unit per consented active seat and cycle using a unique database key", async () => {
    await queueSeatUsage(state.tx as any, "shop", now);
    const call = state.tx.seatUsage.createMany.mock.calls[0][0];
    expect(call.skipDuplicates).toBe(true);
    expect(call.data[0]).toMatchObject({ shopId: "shop", seatId: "seat", shopifyShopGid: "gid://shopify/Shop/1", periodStart: new Date("2026-10-01T00:00Z"), occurredAt: now.toJSDate() });
    expect(state.tx.teamSeat.findMany.mock.calls[0][0].where).toEqual({ active: true, billingConsentAt: { not: null } });
  });
  it("does not charge a trial, closed cycle, missing meter, or inactive plan", async () => {
    for (const changes of [{ currentPeriodStart: null }, { currentPeriodEnd: new Date("2026-10-01T00:00Z") }, { seatMeterActive: false }, { status: "INACTIVE" }]) {
      const normal = await state.tx.subscription.findUnique();
      state.tx.subscription.findUnique.mockResolvedValueOnce({ ...normal, ...changes });
      await queueSeatUsage(state.tx as any, "shop", now);
    }
    expect(state.tx.seatUsage.createMany).not.toHaveBeenCalled();
  });
  it("uses an opaque stable idempotency key and sends no seat email or name", async () => {
    vi.stubEnv("SHOPIFY_API_KEY", "app"); vi.stubEnv("SHOPIFY_API_SECRET", "secret");
    state.tx.seatUsage.findUnique.mockResolvedValue({ id: "3e7a6b53-f312-4f95-a489-00bce7907fab", shopifyShopGid: "gid://shopify/Shop/1", occurredAt: now.toJSDate(), submittedAt: null, attempts: 0 });
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ access_token: "token", expires_in: 3600, scope: "write_global_api_app_events" })).mockResolvedValueOnce(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetcher);
    await submitSeatUsage("shop", "usage");
    const body = JSON.parse(fetcher.mock.calls[1]![1]!.body);
    expect(body.idempotency_key).toBe("seat-3e7a6b53-f312-4f95-a489-00bce7907fab");
    expect(body.attributes).toEqual({ value: 1 });
    expect(JSON.stringify(body)).not.toContain("email");
    expect(state.tx.seatUsage.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ submittedAt: expect.any(Date) }) }));
  });
});
