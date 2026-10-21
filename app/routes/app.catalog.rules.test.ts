import { describe, expect, it, vi, beforeEach } from "vitest";
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  db: { availabilityRule: { create: vi.fn(), update: vi.fn(), delete: vi.fn() } },
}));
vi.mock("../lib/auth/admin.server", () => ({ requireShop: mocks.auth }));
import { action } from "./app.catalog.rules";
function args(values: Record<string, string>) {
  const request = new Request("https://booknest.example/app/catalog/rules", { method: "POST", body: new URLSearchParams(values) });
  return { request, url: new URL(request.url), pattern: "/app/catalog/rules", params: {}, context: {} };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ shop: { id: "shop" }, db: mocks.db });
});
describe("weekly hours resource route", () => {
  it("saves a new rule for a single weekday and returns ok without redirecting", async () => {
    const result = await action(args({ intent: "rule.save", staffId: "a", weekday: "1", startTime: "09:00", endTime: "17:00", timezone: "UTC" }));
    expect(mocks.db.availabilityRule.create).toHaveBeenCalledWith({ data: expect.objectContaining({ shopId: "shop", staffId: "a", weekday: 1, startTime: "09:00", endTime: "17:00" }) });
    expect(result).toEqual({ ok: true });
  });
  it("updates only the time range of an existing rule, not its owner or weekday", async () => {
    const result = await action(args({ intent: "rule.update", id: "rule-a", startTime: "10:00", endTime: "18:00" }));
    expect(mocks.db.availabilityRule.update).toHaveBeenCalledWith({ where: { id: "rule-a" }, data: { startTime: "10:00", endTime: "18:00" } });
    expect(result).toEqual({ ok: true });
  });
  it("rejects an update where start and end times are equal", async () => {
    const result = await action(args({ intent: "rule.update", id: "rule-a", startTime: "09:00", endTime: "09:00" }));
    expect(result).toMatchObject({ data: { error: expect.any(String) } });
    expect(mocks.db.availabilityRule.update).not.toHaveBeenCalled();
  });
  it("deletes a rule by id", async () => {
    const result = await action(args({ intent: "rule.delete", id: "rule-a" }));
    expect(mocks.db.availabilityRule.delete).toHaveBeenCalledWith({ where: { id: "rule-a" } });
    expect(result).toEqual({ ok: true });
  });
  it("requires choosing exactly one Availability or Event/Service", async () => {
    const result = await action(args({ intent: "rule.save", staffId: "a", serviceId: "b", weekday: "1", startTime: "09:00", endTime: "17:00", timezone: "UTC" }));
    expect(result).toMatchObject({ data: { error: expect.any(String) } });
    expect(mocks.db.availabilityRule.create).not.toHaveBeenCalled();
  });
});
