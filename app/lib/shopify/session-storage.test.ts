import { beforeEach, describe, expect, it, vi } from "vitest";
import { Session } from "@shopify/shopify-app-react-router/server";
import { ShopifySessionStorage } from "./session-storage.server";
const table = { upsert: vi.fn(), findUnique: vi.fn(), deleteMany: vi.fn(), findMany: vi.fn() };
describe("persistent Shopify sessions", () => {
  beforeEach(() => vi.clearAllMocks());
  it("round-trips an offline session with expiry and refresh credentials", async () => {
    const session = new Session({
      id: "offline_a.myshopify.com", shop: "a.myshopify.com", state: "state-a", isOnline: false,
      accessToken: "token-a", scope: "read_products", expires: new Date("2026-10-15T10:00:00Z"),
      refreshToken: "refresh-a", refreshTokenExpires: new Date("2026-11-15T10:00:00Z"),
    });
    table.upsert.mockImplementation(async ({ create }) => { table.findUnique.mockResolvedValue(create); });
    const storage = new ShopifySessionStorage(table);
    expect(await storage.storeSession(session)).toBe(true);
    expect((await storage.loadSession(session.id))?.equals(session)).toBe(true);
  });
  it("round-trips online user identity without changing the session SDK", async () => {
    const session = Session.fromPropertyArray([
      ["id", "online-a"], ["shop", "a.myshopify.com"], ["state", "state"], ["isOnline", true],
      ["accessToken", "online-token"], ["userId", "123"], ["firstName", "Alex"],
      ["lastName", "Example"], ["email", "alex@example.com"], ["locale", "en"],
      ["accountOwner", true], ["collaborator", false], ["emailVerified", true],
    ], true);
    table.upsert.mockImplementation(async ({ create }) => { table.findUnique.mockResolvedValue(create); });
    const storage = new ShopifySessionStorage(table);
    await storage.storeSession(session);
    const loaded = await storage.loadSession(session.id);
    expect(loaded).toBeInstanceOf(Session);
    expect(loaded?.onlineAccessInfo?.associated_user.id).toBe(123);
    expect(loaded?.onlineAccessInfo?.associated_user.email).toBe("alex@example.com");
  });
  it("returns undefined for an unknown session", async () => {
    table.findUnique.mockResolvedValue(null);
    expect(await new ShopifySessionStorage(table).loadSession("missing")).toBeUndefined();
  });
  it("uses exact session IDs for idempotent deletion", async () => {
    const storage = new ShopifySessionStorage(table);
    await storage.deleteSession("session-a");
    await storage.deleteSessions(["session-b", "session-c"]);
    expect(table.deleteMany.mock.calls).toEqual([
      [{ where: { id: { in: ["session-a"] } } }],
      [{ where: { id: { in: ["session-b", "session-c"] } } }],
    ]);
  });
  it("scopes a session listing to the specified Shopify domain", async () => {
    table.findMany.mockResolvedValue([]);
    await new ShopifySessionStorage(table).findSessionsByShop("a.myshopify.com");
    expect(table.findMany).toHaveBeenCalledWith({ where: { shop: "a.myshopify.com" } });
  });
  it("propagates storage outages instead of reporting a successful deletion", async () => {
    table.deleteMany.mockRejectedValue(new Error("database unavailable"));
    await expect(new ShopifySessionStorage(table).deleteSession("session-a")).rejects.toThrow("database unavailable");
  });
});
