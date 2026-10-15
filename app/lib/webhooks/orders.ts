import { z } from "zod";
const identifier = z.union([z.string().min(1), z.number().int().safe()]).transform(String);
const money = z.string().regex(/^\d+(?:\.\d{1,2})?$/);
const lineSchema = z.object({
  id: identifier, variant_id: identifier.nullable().optional().default(null), quantity: z.number().int().positive(),
  properties: z.array(z.object({ name: z.string(), value: z.union([z.string(), z.number()]).transform(String) })).default([]),
  price: money, total_discount: money.default("0"),
  price_set: z.object({ shop_money: z.object({ amount: money, currency_code: z.string() }) }).optional(),
  total_discount_set: z.object({ shop_money: z.object({ amount: money, currency_code: z.string() }) }).optional(),
});
export const orderSchema = z.object({
  id: identifier, financial_status: z.string(), currency: z.string(),
  email: z.string().email().nullable().optional(), contact_email: z.string().email().nullable().optional(),
  customer: z.object({ id: identifier, first_name: z.string().nullable().optional(), last_name: z.string().nullable().optional() }).nullable().optional(),
  line_items: z.array(lineSchema),
});
export function matchesOrderLine(hold: { variantId: string | null; quantity: number; depositType: string }, line: { variant_id: string | null; quantity: number }) {
  if (hold.quantity !== line.quantity) return false;
  return hold.variantId ? hold.variantId.split("/").pop() === line.variant_id
    : ["FIXED", "PERCENT"].includes(hold.depositType) && line.variant_id === null;
}
const cents = (value: string) => { const [whole, fraction = ""] = value.split("."); return Number(whole) * 100 + Number(fraction.padEnd(2, "0")); };
export function linePaidCents(line: { quantity: number; price: string; total_discount: string; price_set?: { shop_money: { amount: string } }; total_discount_set?: { shop_money: { amount: string } } }) {
  return Math.max(0, cents(line.price_set?.shop_money.amount ?? line.price) * line.quantity - cents(line.total_discount_set?.shop_money.amount ?? line.total_discount));
}
