import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ tx: {} as Record<string, any>, run: vi.fn() }));
vi.mock("../../db.server", () => ({ getShopDatabase: () => state.tx, withShopTransaction: (...args: unknown[]) => state.run(...args) }));
import { processCustomerRequest } from "./privacy.server";
beforeEach(() => {
  state.tx = {
    booking: { findMany: vi.fn().mockResolvedValue([{ id: "b1", reservationId: "r1", startAt: new Date("2030-01-01T09:00Z"), googleEventId: "event" }]), update: vi.fn() },
    notificationTask: { deleteMany: vi.fn(), create: vi.fn() }, intakeAnswer: { deleteMany: vi.fn() },
    reservation: { updateMany: vi.fn() }, webhookReceipt: { updateMany: vi.fn() },
  };
  state.run.mockReset().mockImplementation((_shop, work) => work(state.tx));
});
describe("customer data redaction", () => {
  it("clears copied intake answers from reservations and revokes customer links", async () => {
    await processCustomerRequest("shop", "receipt", { customer: { id: 1, email: "customer@example.com" } }, true);
    expect(state.tx.reservation.updateMany).toHaveBeenCalledWith({ where: { id: { in: ["r1"] } }, data: { answers: [], checkoutUrl: null } });
    expect(state.tx.booking.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ customerEmail: "", notes: null, cancelToken: expect.any(String) }) }));
    expect(state.run.mock.calls[0]?.[0]).toBe("shop");
  });
  it("removes pending notification copies and queues calendar anonymization", async () => {
    await processCustomerRequest("shop", "receipt", { customer: { id: 1 } }, true);
    expect(state.tx.notificationTask.deleteMany).toHaveBeenCalledWith({ where: { bookingId: { in: ["b1"] } } });
    expect(state.tx.notificationTask.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ shopId: "shop", bookingId: "b1", kind: "CALENDAR_SYNC" }) }));
    expect(state.tx.webhookReceipt.updateMany).toHaveBeenCalled();
  });
});
