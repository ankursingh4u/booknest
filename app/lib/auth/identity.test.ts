import { beforeEach, describe, expect, it, vi } from "vitest";
const identityDb = vi.hoisted(() => ({ upsert: vi.fn(), findUnique: vi.fn(), extends: vi.fn() }));
vi.mock("@prisma/client", async (original) => {
  const actual = await original<typeof import("@prisma/client")>();
  return { ...actual, PrismaClient: class { shop = identityDb; $extends = identityDb.extends; } };
});
import { syncShopIdentity, findShopIdentity } from "../../db.server";

describe("verified Shopify identity repository", () => {
  beforeEach(() => vi.clearAllMocks());
  it("bootstraps the shop only from the verified session domain", async () => {
    identityDb.upsert.mockResolvedValue({ id: "shop-a", domain: "a.myshopify.com" });
    await syncShopIdentity({ shop: "a.myshopify.com", accessToken: "token-a", scope: "read_products", isOnline: false });
    expect(identityDb.upsert).toHaveBeenCalledWith({
      where: { domain: "a.myshopify.com" },
      create: { domain: "a.myshopify.com", accessToken: "token-a", scope: "read_products" },
      update: { accessToken: "token-a", scope: "read_products", uninstalledAt: null },
    });
  });
  it("rejects identity bootstrapping without an access token", async () => {
    await expect(syncShopIdentity({ shop: "a.myshopify.com", accessToken: "", isOnline: false })).rejects.toThrow(/identity/i);
    expect(identityDb.upsert).not.toHaveBeenCalled();
  });
  it("does not overwrite the offline token with an online user token", async () => {
    await syncShopIdentity({ shop: "a.myshopify.com", accessToken: "online-token", isOnline: true });
    expect(identityDb.upsert).not.toHaveBeenCalled();
  });
  it("validates Shopify domains before database lookup", async () => {
    await expect(findShopIdentity("attacker.example")).rejects.toThrow(/identity/i);
    expect(identityDb.findUnique).not.toHaveBeenCalled();
  });
  it("selects only merchant metadata, never access tokens", async () => {
    await findShopIdentity("a.myshopify.com");
    expect(identityDb.findUnique).toHaveBeenCalledWith({
      where: { domain: "a.myshopify.com" },
      select: { id: true, domain: true, plan: true, onboardedAt: true },
    });
  });
});
