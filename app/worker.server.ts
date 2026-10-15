import { unauthenticated } from "./shopify.server";
import { syncBilling } from "./lib/billing/service.server";
import { seatBillingEnabled, submitSeatUsage } from "./lib/billing/seats.server";
import { syncBookingCalendar } from "./lib/calendar/sync.server";
import { BookingError } from "./lib/bookings/validation";
import { DateTime } from "luxon";
import PgBoss from "pg-boss";
import { CUSTOMER_DATA_RETENTION_MONTHS, getShopDatabase, markShopUninstalled, pendingBackgroundJobs, purgeExpiredCustomerData, purgeShopData, storesForSeatBilling } from "./db.server";
import { processOrder, processOrderCancellation, processRefund } from "./lib/webhooks/orders.server";
import { processCustomerRequest } from "./lib/webhooks/privacy.server";
import { sendNotification } from "./lib/notifications/send.server";
const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!connectionString) throw new Error("Worker requires a database connection");
const boss = new PgBoss({ connectionString, schema: "pgboss" });
boss.on("error", () => console.error("BookNest queue error"));
await boss.start();
await boss.createQueue("booknest-webhooks");
await boss.createQueue("booknest-notifications");
await boss.createQueue("booknest-seat-usage");
type Job = { shopId: string; id: string };
await boss.work<Job>("booknest-webhooks", { batchSize: 1 }, async jobs => {
  for (const { data } of jobs) {
    const db = getShopDatabase(data.shopId);
    const receipt = await db.webhookReceipt.findUnique({ where: { id: data.id } });
    if (!receipt || receipt.processedAt || receipt.attempts >= 5) continue;
    try {
      switch (receipt.topic) {
        case "ORDERS_CREATE": case "ORDERS_PAID": await processOrder(data.shopId, receipt.payload); break;
        case "ORDERS_CANCELLED": await processOrderCancellation(data.shopId, receipt.payload); break;
        case "REFUNDS_CREATE": await processRefund(data.shopId, receipt.id, receipt.payload); break;
        case "APP_UNINSTALLED": await markShopUninstalled(data.shopId, DateTime.utc().toJSDate()); break;
        case "CUSTOMERS_DATA_REQUEST": await processCustomerRequest(data.shopId, receipt.id, receipt.payload, false); break;
        case "CUSTOMERS_REDACT": await processCustomerRequest(data.shopId, receipt.id, receipt.payload, true); break;
        case "SHOP_REDACT": await purgeShopData(data.shopId); continue;
        default: throw new Error("Unsupported webhook topic");
      }
      const payload = receipt.payload as Record<string, unknown>;
      await db.webhookReceipt.update({ where: { id: receipt.id }, data: { processedAt: DateTime.utc().toJSDate(), lastError: null,
        payload: receipt.topic === "ORDERS_CANCELLED" ? { id: String(payload.id) } : receipt.topic === "REFUNDS_CREATE" ? { order_id: String(payload.order_id) } : {} } });
    } catch (error) {
      await db.webhookReceipt.update({ where: { id: receipt.id }, data: { attempts: { increment: 1 }, lastError: error instanceof BookingError ? error.message : "Processing failed. Check app configuration and retry." } });
      throw new Error("Webhook processing failed");
    }
  }
});
await boss.work<Job>("booknest-notifications", { batchSize: 1 }, async jobs => {
  for (const { data } of jobs) {
    try {
      const task = await getShopDatabase(data.shopId).notificationTask.findUnique({ where: { id: data.id }, select: { kind: true } });
      if (task?.kind === "CALENDAR_SYNC") await syncBookingCalendar(data.shopId, data.id);
      else await sendNotification(data.shopId, data.id);
    }
    catch {
      await getShopDatabase(data.shopId).notificationTask.updateMany({ where: { id: data.id }, data: { attempts: { increment: 1 }, lastError: "Delivery or calendar sync failed. Check the connection and retry." } });
      throw new Error("Notification delivery failed");
    }
  }
});
await boss.work<Job>("booknest-seat-usage", { batchSize: 1 }, async jobs => {
  for (const { data } of jobs) {
    try { await submitSeatUsage(data.shopId, data.id); }
    catch {
      await getShopDatabase(data.shopId).seatUsage.updateMany({ where: { id: data.id, submittedAt: null }, data: { attempts: { increment: 1 }, lastError: "Seat usage delivery failed. Review Shopify billing configuration before retrying." } });
      throw new Error("Seat usage delivery failed");
    }
  }
});
let lastBillingRefresh = 0;
let lastRetentionRun = 0;
let scanning = false;
async function scan() {
  if (scanning) return;
  scanning = true;
  try {
    const pending = await pendingBackgroundJobs(DateTime.utc().toJSDate());
    for (const [name, jobs] of [["booknest-webhooks", pending.webhooks], ["booknest-notifications", pending.notifications], ["booknest-seat-usage", seatBillingEnabled() ? pending.seatUsage : []]] as const) {
      for (const job of jobs) await boss.send(name, job, { singletonKey: job.id, singletonSeconds: 60, retryLimit: 3, retryDelay: 30, retryBackoff: true });
    }
    if (seatBillingEnabled() && DateTime.utc().toMillis() - lastBillingRefresh > 60000) {
      lastBillingRefresh = DateTime.utc().toMillis();
      for (const shop of await storesForSeatBilling()) {
        try { const { admin } = await unauthenticated.admin(shop.domain); await syncBilling(shop.id, shop.domain, admin, true); }
        catch { console.error("BookNest subscription refresh failed"); }
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    if (DateTime.utc().toMillis() - lastRetentionRun > 86400000) {
      lastRetentionRun = DateTime.utc().toMillis();
      try { await purgeExpiredCustomerData(DateTime.utc().minus({ months: CUSTOMER_DATA_RETENTION_MONTHS }).toJSDate()); }
      catch { console.error("BookNest retention purge failed"); }
    }
  } catch { console.error("BookNest background scan failed"); }
  finally { scanning = false; }
}
await scan();
const timer = setInterval(() => { void scan(); }, 15000);
for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, async () => {
  clearInterval(timer);
  await boss.stop({ graceful: true, timeout: 10000 });
  process.exit(0);
});
