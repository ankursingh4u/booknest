import { describe, expect, it, vi } from "vitest";
import type { ActionFunctionArgs } from "react-router";
import { BookingError } from "../lib/bookings/validation";
const mocks = vi.hoisted(() => ({ mutate: vi.fn(), auth: vi.fn().mockResolvedValue({ shop: { id: "verified-shop" }, admin: {} }) }));
vi.mock("../lib/auth/admin.server", () => ({ requireShop: mocks.auth }));
vi.mock("../lib/admin/catalog.server", () => ({
  catalogData: vi.fn(), catalogKind: { parse: (value: string) => value }, mutateCatalog: mocks.mutate,
  CatalogError: class CatalogError extends Error {},
}));
vi.mock("@shopify/polaris", () => ({ Page: () => null, Card: () => null, BlockStack: () => null, Text: () => null, Badge: () => null, Banner: () => null }));
vi.mock("@shopify/app-bridge-react", () => ({ useAppBridge: () => ({}) }));
import { action } from "./app.catalog";
function requestWith(values: FormData) {
  return { request: new Request("https://booknestapp.site/app/manage/services", { method: "POST", body: values }), params: { kind: "services" }, context: {} } as unknown as ActionFunctionArgs;
}
describe("catalog product creation error recovery", () => {
  it("keeps the same product creation key and fields after a recoverable publishing failure", async () => {
    mocks.mutate.mockRejectedValueOnce(new BookingError("The product was created; retry publishing.", 503));
    const form = new FormData();
    for (const [name, value] of Object.entries({ intent: "save", id: "", creationKey: "3aed6954-030f-4ab8-9a09-8a2af4c33ac0", productMode: "new", title: "Yoga", price: "29.99", slug: "yoga", description: "Arrive early" })) form.set(name, value);
    form.append("staffIds", "staff-a"); form.append("staffIds", "staff-b");
    const result = await action(requestWith(form));
    if (result instanceof Response) throw new Error("Expected recoverable action data");
    expect(result.data.submitted).toEqual(expect.objectContaining({
      id: "", creationKey: form.get("creationKey"), staffIds: ["staff-a", "staff-b"],
      values: expect.objectContaining({ title: "Yoga", slug: "yoga", price: "29.99", productMode: "new", description: "Arrive early" }),
    }));
    expect(result.init?.status).toBe(503);
    expect(mocks.auth).toHaveBeenCalled();
    expect(mocks.mutate.mock.calls.at(-1)?.[0]).toBe("verified-shop");
  });
  it("returns only bounded editable catalog fields when reflecting validation errors", async () => {
    mocks.mutate.mockRejectedValueOnce(new BookingError("Please retry.", 400));
    const form = new FormData();
    form.set("intent", "save"); form.set("id", "service"); form.set("creationKey", "invalid");
    form.set("privateKey", "must not return this unknown field"); form.set("description", "x".repeat(7000));
    const result = await action(requestWith(form));
    if (result instanceof Response) throw new Error("Expected recoverable action data");
    expect(result.data.submitted?.values).not.toHaveProperty("privateKey");
    expect(result.data.submitted?.values.description?.length).toBeLessThanOrEqual(5000);
    expect(result.data.submitted?.creationKey).toBe("");
  });
});
