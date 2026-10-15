import { verifyNonce } from "./lib/calendar/secrets.server";
import { tenantTransaction } from "./lib/db/transaction.server";
import { Prisma, PrismaClient } from "@prisma/client";
import { ShopifySessionStorage } from "./lib/shopify/session-storage.server";
import { z } from "zod";
import { assertShopId, scopeTenantQuery, validateTenantReferences } from "./lib/db/tenant.server";

const globalForPrisma = globalThis as unknown as { booknestPrisma?: PrismaClient };
const prisma = globalForPrisma.booknestPrisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.booknestPrisma = prisma;

/** Only pass a shopId resolved from a verified Shopify session, never request input. */
export function getShopDatabase(shopId: string): PrismaClient {
  assertShopId(shopId);
  return prisma.$extends({
    name: "booknest-tenant-isolation",
    query: {
      async $allOperations({ model, operation, args, query }) {
        if (!model) throw new Error("Raw queries require an explicitly scoped repository");
        const scoped = scopeTenantQuery(model, operation, args as Record<string, unknown>, shopId);
        const lookup = async (relatedModel: string, where: Record<string, unknown>) => {
          const key = relatedModel.charAt(0).toLowerCase() + relatedModel.slice(1);
          const delegate = (prisma as unknown as Record<string, {
            findFirst(input: { where: Record<string, unknown> }): Promise<unknown>;
          }>)[key];
          if (!delegate) throw new Error("Unsupported related model: " + relatedModel);
          return Boolean(await delegate.findFirst({ where }));
        };
        for (const field of ["data", "create", "update"]) {
          if (field in scoped) await validateTenantReferences(model, scoped[field], shopId, lookup);
        }
        return query(scoped as typeof args);
      },
    },
  }) as unknown as PrismaClient;
}

type VerifiedSessionIdentity = {
  shop: string;
  accessToken?: string;
  scope?: string;
  isOnline: boolean;
};
const shopDomain = z.string().regex(/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/);

function assertVerifiedDomain(domain: string) {
  if (!shopDomain.safeParse(domain).success) throw new Error("Invalid Shopify identity");
}

/** Called only from Shopify's afterAuth hook, after session verification. */
export async function syncShopIdentity(session: VerifiedSessionIdentity) {
  assertVerifiedDomain(session.shop);
  if (session.isOnline) return;
  if (!session.accessToken) throw new Error("Invalid Shopify identity: missing offline access token");
  const identity = { accessToken: session.accessToken, scope: session.scope ?? "" };
  return prisma.shop.upsert({
    where: { domain: session.shop },
    create: { domain: session.shop, ...identity },
    update: { ...identity, uninstalledAt: null },
  });
}

/** Domain is taken from the verified session; only non-secret fields are returned. */
export async function findShopIdentity(domain: string) {
  assertVerifiedDomain(domain);
  return prisma.shop.findUnique({
    where: { domain },
    select: { id: true, domain: true, plan: true, onboardedAt: true },
  });
}

let storage: ShopifySessionStorage | undefined;
/** Authentication infrastructure owns session access; routes never receive the raw client. */
export function getSessionStorage() {
  return storage ??= new ShopifySessionStorage(prisma.session);
}

/** Serializes mutations for each Availability; callbacks only see scoped delegates. */
export async function withShopTransaction<T>(
  shopId: string, work: (tx: Prisma.TransactionClient) => Promise<T>, staffLocks: string[] = [], orderLocks: string[] = [],
): Promise<T> {
  assertShopId(shopId);
  return prisma.$transaction(async (tx) => {
    // Order locks always precede Availability locks; cancellation shares this order.
    for (const orderId of [...new Set(orderLocks)].sort()) {
      if (!orderId || orderId.length > 100) throw new Error("Invalid order");
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${shopId + ":order:" + orderId}, 0))`;
    }
    for (const staffId of [...new Set(staffLocks)].sort()) {
      if (!staffId || staffId.length > 100) throw new Error("Invalid Availability");
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${shopId + ":" + staffId}, 0))`;
    }
    return work(tenantTransaction(tx, shopId));
  }, { maxWait: 10000, timeout: 20000, isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

/** Worker-only enumeration. Application routes continue to use the scoped client. */
export async function pendingBackgroundJobs(now: Date) {
  await prisma.googleOAuthState.deleteMany({ where: { expiresAt: { lt: now } } });
  const [webhooks, notifications, seatUsage] = await Promise.all([
    prisma.webhookReceipt.findMany({ where: { processedAt: null, attempts: { lt: 5 } }, select: { id: true, shopId: true }, orderBy: { createdAt: "asc" }, take: 100 }),
    prisma.notificationTask.findMany({ where: { completedAt: null, attempts: { lt: 5 }, runAt: { lte: now }, shop: { uninstalledAt: null } },
      select: { id: true, shopId: true }, orderBy: { runAt: "asc" }, take: 100 }),
    prisma.seatUsage.findMany({ where: { submittedAt: null, attempts: { lt: 5 } }, select: { id: true, shopId: true }, orderBy: { occurredAt: "asc" }, take: 100 }),
  ]);
  return { webhooks, notifications, seatUsage };
}
export async function markShopUninstalled(shopId: string, now: Date) {
  const shop = await prisma.shop.findUniqueOrThrow({ where: { id: shopId }, select: { domain: true } });
  await prisma.$transaction([
    prisma.session.deleteMany({ where: { shop: shop.domain } }),
    prisma.shop.update({ where: { id: shopId }, data: { accessToken: "", uninstalledAt: now } }),
  ]);
}
/** Customer PII is anonymized this long after the appointment date; see /privacy. */
export const CUSTOMER_DATA_RETENTION_MONTHS = 24;

/** Worker-only; anonymizes customer PII past the retention window. Booking rows and their
 * times/status/price are kept for aggregate reporting, matching the privacy policy. */
export async function purgeExpiredCustomerData(cutoff: Date) {
  const expired = await prisma.booking.findMany({
    where: { startAt: { lt: cutoff }, customerEmail: { not: "" } },
    select: { id: true, shopId: true },
  });
  const byShop = new Map<string, string[]>();
  for (const booking of expired) byShop.set(booking.shopId, [...(byShop.get(booking.shopId) ?? []), booking.id]);
  for (const [shopId, ids] of byShop) {
    await withShopTransaction(shopId, async tx => {
      await tx.notificationTask.deleteMany({ where: { bookingId: { in: ids } } });
      await tx.intakeAnswer.deleteMany({ where: { bookingId: { in: ids } } });
      await tx.booking.updateMany({ where: { id: { in: ids } }, data: { customerId: null, customerEmail: "", customerName: null, customerPhone: null, notes: null } });
    });
  }
  return expired.length;
}

/** Called only for a verified SHOP_REDACT webhook. */
export async function purgeShopData(shopId: string) {
  const shop = await prisma.shop.findUnique({ where: { id: shopId }, select: { domain: true } });
  if (!shop) return;
  await prisma.$transaction(async tx => {
    await tx.session.deleteMany({ where: { shop: shop.domain } });
    await tx.accessLog.deleteMany({ where: { shopId } });
    await tx.notificationTask.deleteMany({ where: { shopId } });
    await tx.jobLog.deleteMany({ where: { booking: { shopId } } });
    await tx.intakeAnswer.deleteMany({ where: { booking: { shopId } } });
    await tx.booking.deleteMany({ where: { shopId } });
    await tx.reservation.deleteMany({ where: { shopId } });
    await tx.blackout.deleteMany({ where: { shopId } });
    await tx.additionalHours.deleteMany({ where: { shopId } });
    await tx.serviceStaff.deleteMany({ where: { service: { shopId } } });
    await tx.service.deleteMany({ where: { shopId } });
    await tx.staffMember.deleteMany({ where: { shopId } });
    await tx.location.deleteMany({ where: { shopId } });
    await tx.shop.delete({ where: { id: shopId } });
  });
}
/** The unguessable customer token is the authorization credential for one booking. */
export async function resolveCustomerBooking(token: string) {
  if (!/^[a-zA-Z0-9-]{20,100}$/.test(token)) return null;
  return prisma.booking.findUnique({ where: { cancelToken: token },
    select: { id: true, shopId: true, serviceId: true, staffId: true, quantity: true, startAt: true, endAt: true, status: true,
      customerName: true, service: { select: { title: true } }, location: { select: { name: true, timezone: true } },
      staff: { select: { firstName: true, lastName: true } } } });
}

/** OAuth state and the first-party browser nonce authorize this one-time callback. */
export async function consumeGoogleOAuthState(id: string, nonce: string, now: Date) {
  if (!/^[a-f0-9-]{36}$/i.test(id)) return null;
  return prisma.$transaction(async tx => {
    const state = await tx.googleOAuthState.findUnique({ where: { id } });
    if (!state || state.usedAt || state.expiresAt <= now || !verifyNonce(state.nonceHash, nonce)) return null;
    const claim = await tx.googleOAuthState.updateMany({ where: { id, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } });
    return claim.count === 1 ? state : null;
  });
}

/** An invitation hash is a capability for one seat; raw tokens are never stored. */
export async function resolveTeamInvitation(tokenHash: string, now: Date, consume = false) {
  if (!/^[a-f0-9]{64}$/.test(tokenHash)) return null;
  return prisma.$transaction(async tx => {
    const seat = await tx.teamSeat.findFirst({ where: { inviteTokenHash: tokenHash, inviteExpiresAt: { gt: now }, active: true, shop: { uninstalledAt: null } },
      select: { id: true, shopId: true, email: true, staffId: true, sessionVersion: true, shop: { select: { domain: true } } } });
    if (!seat || !seat.staffId) return null;
    const staff = await tx.staffMember.findFirst({ where: { id: seat.staffId, shopId: seat.shopId, active: true }, select: { firstName: true, lastName: true } });
    if (!staff) return null;
    if (consume) {
      const claimed = await tx.teamSeat.updateMany({ where: { id: seat.id, shopId: seat.shopId, active: true, inviteTokenHash: tokenHash, inviteExpiresAt: { gt: now } },
        data: { inviteTokenHash: null, inviteExpiresAt: null } });
      if (claimed.count !== 1) return null;
    }
    return { ...seat, staff };
  });
}

let billingRefreshCursor = "";
/** Worker-only fair pagination over stores with consented team seats. */
export async function storesForSeatBilling() {
  const rows = await prisma.shop.findMany({ where: { id: { gt: billingRefreshCursor }, uninstalledAt: null,
    seats: { some: { active: true, billingConsentAt: { not: null } } } },
    select: { id: true, domain: true }, orderBy: { id: "asc" }, take: 25 });
  billingRefreshCursor = rows.length === 25 ? rows[24]!.id : "";
  return rows;
}
