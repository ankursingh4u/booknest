import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ tx: {} as Record<string, any>, run: vi.fn() }));
vi.mock("../../db.server", () => ({ getShopDatabase: () => state.tx, withShopTransaction: (...args: unknown[]) => state.run(...args) }));
import { decideTimeOff } from "./time-off.server";
beforeEach(() => {
  state.tx = {
    timeOffRequest: { findFirstOrThrow: vi.fn().mockResolvedValue({ id: "r", staffId: "s", status: "PENDING", startAt: new Date("2030-10-20T09:00Z"), endAt: new Date("2030-10-20T17:00Z") }), update: vi.fn() },
    booking: { count: vi.fn().mockResolvedValue(0) }, reservation: { count: vi.fn().mockResolvedValue(0) },
  };
  state.run.mockReset().mockImplementation((_shop, work) => work(state.tx));
});
describe("time off approval", () => {
  it("serializes approval with bookings for the same Availability", async () => {
    await decideTimeOff("shop", "r", "APPROVED");
    expect(state.run.mock.calls[0]?.[2]).toEqual(["s"]);
    expect(state.tx.timeOffRequest.update).toHaveBeenCalledWith({ where: { id: "r", status: "PENDING" }, data: { status: "APPROVED" } });
  });
  it("requires existing bookings to be resolved before approval", async () => {
    state.tx.booking.count.mockResolvedValue(1);
    await expect(decideTimeOff("shop", "r", "APPROVED")).rejects.toThrow("existing bookings");
    expect(state.tx.timeOffRequest.update).not.toHaveBeenCalled();
  });
  it("blocks approval during active checkout holds", async () => {
    state.tx.reservation.count.mockResolvedValue(1);
    await expect(decideTimeOff("shop", "r", "APPROVED")).rejects.toThrow("checkout");
  });
  it("allows a declined request without changing bookings", async () => {
    state.tx.booking.count.mockResolvedValue(1);
    await decideTimeOff("shop", "r", "DECLINED");
    expect(state.tx.booking.count).not.toHaveBeenCalled();
  });
});
