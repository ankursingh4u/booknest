import { beforeEach, describe, expect, it, vi } from "vitest";
const authMocks = vi.hoisted(() => ({ admin: vi.fn(), findShop: vi.fn(), scoped: vi.fn() }));
vi.mock("../../shopify.server", () => ({ authenticate: { admin: authMocks.admin } }));
vi.mock("../../db.server", () => ({ findShopIdentity: authMocks.findShop, getShopDatabase: authMocks.scoped }));
import { requireShop } from "./admin.server";

describe("admin request authentication", () => {
  beforeEach(() => vi.clearAllMocks());
  it("uses the verified session instead of a caller-supplied shop", async () => {
    authMocks.admin.mockResolvedValue({ session: { shop: "a.myshopify.com" } });
    authMocks.findShop.mockResolvedValue({ id: "shop-a", domain: "a.myshopify.com", plan: "FREE" });
    authMocks.scoped.mockReturnValue({ tenant: "shop-a" });
    const result = await requireShop(new Request("https://booknestapp.site/app?shop=b.myshopify.com&shopId=shop-b"));
    expect(authMocks.findShop).toHaveBeenCalledWith("a.myshopify.com");
    expect(authMocks.scoped).toHaveBeenCalledWith("shop-a");
    expect(result.shop.id).toBe("shop-a");
  });
  it("propagates Shopify authentication responses before data access", async () => {
    const response = new Response(null, { status: 401 });
    authMocks.admin.mockRejectedValue(response);
    await expect(requireShop(new Request("https://booknestapp.site/app"))).rejects.toBe(response);
    expect(authMocks.findShop).not.toHaveBeenCalled();
  });
  it("fails without constructing a tenant client when setup is incomplete", async () => {
    authMocks.admin.mockResolvedValue({ session: { shop: "a.myshopify.com" } });
    authMocks.findShop.mockResolvedValue(null);
    await expect(requireShop(new Request("https://booknestapp.site/app"))).rejects.toMatchObject({ status: 503 });
    expect(authMocks.scoped).not.toHaveBeenCalled();
  });
});
