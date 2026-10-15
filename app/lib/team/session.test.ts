import { afterEach, describe, expect, it, vi } from "vitest";
import { createTeamToken, readTeamToken, requireSameOrigin } from "./session.server";
afterEach(() => vi.unstubAllEnvs());
describe("team session", () => {
  it("accepts a signed, unexpired session", () => {
    vi.stubEnv("SESSION_SECRET", "s".repeat(40));
    const token = createTeamToken({ shopId: "shop", seatId: "seat", version: 2 }, 1000);
    expect(readTeamToken(token, 1001)).toMatchObject({ shopId: "shop", seatId: "seat", version: 2 });
  });
  it("rejects tampering, expiry, malformed tokens and secret rotation", () => {
    vi.stubEnv("SESSION_SECRET", "s".repeat(40));
    const token = createTeamToken({ shopId: "shop", seatId: "seat", version: 2 }, 1000);
    expect(readTeamToken(token + "x", 1001)).toBeNull();
    expect(readTeamToken(token, 1000 + 12 * 60 * 60)).toBeNull();
    expect(readTeamToken("not-a-token", 1001)).toBeNull();
    vi.stubEnv("SESSION_SECRET", "t".repeat(40));
    expect(readTeamToken(token, 1001)).toBeNull();
  });
  it("rejects cross-origin or missing-origin state changes", () => {
    expect(() => requireSameOrigin(new Request("https://booknestapp.site/team", { method: "POST", headers: { Origin: "https://other.site" } }))).toThrow();
    expect(() => requireSameOrigin(new Request("https://booknestapp.site/team", { method: "POST" }))).toThrow();
    expect(() => requireSameOrigin(new Request("https://booknestapp.site/team", { method: "POST", headers: { Origin: "https://booknestapp.site" } }))).not.toThrow();
  });
});
