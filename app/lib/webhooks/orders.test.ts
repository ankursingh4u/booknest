import { expect, it } from "vitest";
import { orderSchema, matchesOrderLine, linePaidCents } from "./orders";
const line = { id: "line", variant_id: "123", quantity: 2, properties: [], price: "12.50", total_discount: "5.00" };
it("rejects changed cart quantity and product variants", () => {
  const hold = { variantId: "gid://shopify/ProductVariant/123", quantity: 2, depositType: "NONE" };
  expect(matchesOrderLine(hold, line)).toBe(true);
  expect(matchesOrderLine(hold, { ...line, quantity: 3 })).toBe(false);
  expect(matchesOrderLine(hold, { ...line, variant_id: "999" })).toBe(false);
});
it("accepts a custom line only for a deposit reservation", () => {
  expect(matchesOrderLine({ variantId: null, quantity: 2, depositType: "FIXED" }, { ...line, variant_id: null })).toBe(true);
  expect(matchesOrderLine({ variantId: null, quantity: 2, depositType: "NONE" }, { ...line, variant_id: null })).toBe(false);
});
it("records the amount paid after line discounts", () => { expect(linePaidCents(line)).toBe(2000); });
it("normalizes verified Shopify order identifiers", () => {
  const order = orderSchema.parse({ id: 42, financial_status: "paid", currency: "USD", email: "a@example.com", line_items: [{ ...line, id: 123 }] });
  expect(order.id).toBe("42");
  expect(order.line_items[0]?.id).toBe("123");
});
