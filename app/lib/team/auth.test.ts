import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ db: {} as Record<string, any>, get: vi.fn() }));
vi.mock("../../db.server", () => ({ getShopDatabase: (id: string) => { state.get(id); return state.db; } }));
import { requireTeam } from "./auth.server";
import { createTeamToken } from "./session.server";
beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "s".repeat(40)); state.get.mockClear();
  state.db = { teamSeat: { findFirst: vi.fn().mockResolvedValue({ id: "seat", staffId: "staff-a" }) }, staffMember: { findFirst: vi.fn().mockResolvedValue({ id: "staff-a", firstName: "A", timezone: "UTC" }) } };
});
afterEach(() => vi.unstubAllEnvs());
function request() {
  const token = createTeamToken({ shopId: "shop-a", seatId: "seat", version: 3 });
  return new Request("https://booknestapp.site/team?shopId=shop-b&staffId=staff-b", { headers: { Cookie: "__Host-bn-team=" + token } });
}
describe("team access", () => {
  it("uses only signed identity and current assigned Availability", async () => {
    const result = await requireTeam(request());
    expect(state.get).toHaveBeenCalledWith("shop-a"); expect(result.staff.id).toBe("staff-a");
    expect(state.db.teamSeat.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "seat", active: true, sessionVersion: 3, shop: { uninstalledAt: null } } }));
    expect(state.db.staffMember.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "staff-a", active: true } }));
  });
  it("rejects a revoked seat or changed session version", async () => {
    state.db.teamSeat.findFirst.mockResolvedValue(null);
    await expect(requireTeam(request())).rejects.toMatchObject({ status: 302 });
    expect(state.db.staffMember.findFirst).not.toHaveBeenCalled();
  });
  it("rejects a deactivated Availability", async () => {
    state.db.staffMember.findFirst.mockResolvedValue(null);
    await expect(requireTeam(request())).rejects.toMatchObject({ status: 302 });
  });
});
