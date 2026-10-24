import Anthropic from "@anthropic-ai/sdk";
import { DateTime } from "luxon";
import { getShopDatabase } from "../../db.server";
import { baselineInsights, parseInsight, summarizeMetrics } from "./metrics";
export async function insightData(shopId: string) {
  const db = getShopDatabase(shopId);
  const shop = await db.shop.findUniqueOrThrow({ where: { id: shopId }, select: { timezone: true } });
  // Measure recent booking ACTIVITY (by when each booking was made), so upcoming appointments are
  // included — a store's dashboard should reflect bookings it just took, not only past appointments.
  const now = DateTime.now().setZone(shop.timezone);
  const today = now.startOf("day");
  const end = now;
  const start = end.minus({ days: 30 });
  const groups = (from: DateTime, to: DateTime) => db.booking.groupBy({ by: ["status", "currency", "quantity"],
    where: { createdAt: { gte: from.toJSDate(), lt: to.toJSDate() } }, _count: { _all: true }, _sum: { priceCents: true, paidCents: true } });
  const [currentGroups, previousGroups, top, snapshot] = await Promise.all([
    groups(start, end), groups(start.minus({ days: 30 }), start),
    db.booking.groupBy({ by: ["serviceId"], where: { createdAt: { gte: start.toJSDate(), lt: end.toJSDate() }, status: { in: ["CONFIRMED", "COMPLETED", "NO_SHOW"] } },
      _count: { _all: true }, _sum: { quantity: true }, orderBy: { _count: { serviceId: "desc" } }, take: 5 }),
    db.insightsSnapshot.findUnique({ where: { shopId_forDate: { shopId, forDate: today.toUTC().toJSDate() } }, select: { highlights: true, nudge: true, model: true, createdAt: true } }),
  ]);
  const services = await db.service.findMany({ where: { id: { in: top.map(s => s.serviceId) } }, select: { id: true, title: true } });
  const current = summarizeMetrics(currentGroups), previous = summarizeMetrics(previousGroups);
  return { current, previous, start: start.toISODate()!, end: today.toISODate()!, timezone: shop.timezone, forDate: today.toUTC().toJSDate(),
    top: top.map(row => ({ title: services.find(s => s.id === row.serviceId)?.title ?? "Archived Event/Service", bookings: row._count._all, guests: row._sum.quantity ?? 0 })),
    insight: snapshot ?? { ...baselineInsights(current, previous), model: "rules-v1", createdAt: null },
    aiAvailable: Boolean(process.env.ANTHROPIC_API_KEY) };
}
export async function generateInsight(shopId: string) {
  const data = await insightData(shopId);
  if (data.insight.createdAt && data.insight.model !== "rules-v1") return { generated: true };
  let insight = baselineInsights(data.current, data.previous), model = "rules-v1", generated = false;
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 0, timeout: 15000 });
      const requestedModel = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";
      const response = await client.messages.create({ model: requestedModel, max_tokens: 600,
        system: 'Summarize appointment metrics for a store manager. Return only a JSON object with highlights (1 to 3 short strings) and nudge (one practical suggestion). Do not invent reasons, forecasts, or financial claims. Revenue is not profit; payments are before refunds. Use only the numeric facts provided. No markdown.',
        messages: [{ role: "user", content: JSON.stringify({ current: data.current, previous: data.previous }) }],
      });
      insight = parseInsight(response.content.filter(block => block.type === "text").map(block => block.type === "text" ? block.text : "").join(""));
      model = requestedModel; generated = true;
    } catch { /* Keep the deterministic, labeled summary when the provider fails. */ }
  }
  const db = getShopDatabase(shopId);
  await db.insightsSnapshot.upsert({ where: { shopId_forDate: { shopId, forDate: data.forDate } },
    create: { shopId, forDate: data.forDate, ...insight, model }, update: { ...insight, model, createdAt: DateTime.utc().toJSDate() } });
  return { generated };
}
