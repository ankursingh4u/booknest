import { beforeEach, expect, it, vi } from "vitest";
import { DateTime } from "luxon";
const state = vi.hoisted(() => ({ previous: {} as Record<string, any>, create: vi.fn() }));
vi.mock("../../db.server", () => ({ withShopTransaction: (_shop: string, work: (db: any) => unknown) => work({ reservation: { findUnique: async () => state.previous, create: state.create } }) }));
import { createReservation } from "./service.server";
const values = { serviceId: "service", staffId: "staff", startAt: "2026-10-19T09:00:00Z", quantity: 1, idempotencyKey: "8adf23e1-653e-4ac4-8db7-e0cfe5350c28", answers: [{ questionId: "q1", value: "Original" }, { questionId: "q2", value: "Second" }] };
const now = DateTime.fromISO("2026-10-18T00:00:00Z");
beforeEach(() => { state.create.mockReset(); state.previous = { ...values, id: "hold", startAt: DateTime.fromISO(values.startAt).toJSDate(), expiresAt: now.plus({ minutes: 10 }).toJSDate(), booking: null }; });
it("rejects changed intake answers instead of silently reusing the old hold snapshot", async () => {
  await expect(createReservation("shop", { ...values, answers: [{ questionId: "q1", value: "Changed" }] }, now)).rejects.toThrow("intake answers");
  expect(state.create).not.toHaveBeenCalled();
});
it("retries the same hold when the same intake answers arrive in a different order", async () => {
  expect((await createReservation("shop", { ...values, answers: [...values.answers].reverse() }, now)).id).toBe("hold");
  expect(state.create).not.toHaveBeenCalled();
});
it("validates replay intake payloads before returning an existing hold", async () => {
  await expect(createReservation("shop", { ...values, answers: "invalid" }, now)).rejects.toThrow();
});
