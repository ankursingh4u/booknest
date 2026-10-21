import { describe, expect, it } from "vitest";
import { themeEditorUrl } from "./theme-link";

describe("themeEditorUrl", () => {
  it("builds a deep link that queues the booking block on the product's page", () => {
    const url = themeEditorUrl("booknest-bzmhjov6.myshopify.com", "977216ff65e771c094a5b882f610bb14", "the-complete-snowboard");
    expect(url).toBe("https://admin.shopify.com/store/booknest-bzmhjov6/themes/current/editor?template=product&addAppBlockId=977216ff65e771c094a5b882f610bb14%2Fbooking&target=mainSection&previewPath=%2Fproducts%2Fthe-complete-snowboard");
  });
  it("rejects malformed inputs", () => {
    expect(() => themeEditorUrl("not-a-shop", "977216ff65e771c094a5b882f610bb14", "handle")).toThrow();
    expect(() => themeEditorUrl("shop.myshopify.com", "not-hex", "handle")).toThrow();
    expect(() => themeEditorUrl("shop.myshopify.com", "977216ff65e771c094a5b882f610bb14", "Bad Handle")).toThrow();
  });
});
