import { DateTime } from "luxon";
import { z } from "zod";
import { getShopDatabase, withShopTransaction } from "../../db.server";
import { blackoutSchema } from "../admin/schemas";
import { CatalogError } from "../admin/catalog.server";
export async function requestTimeOff(shopId: string, staffId: string, form: FormData) {
  const db = getShopDatabase(shopId);
  const staff = await db.staffMember.findFirstOrThrow({ where: { id: staffId, active: true }, select: { timezone: true } });
  const parsed = blackoutSchema.parse({ startLocal: form.get("startLocal"), endLocal: form.get("endLocal"), reason: form.get("reason") || "", timezone: staff.timezone });
  if (parsed.startAt <= DateTime.utc().toJSDate()) throw new CatalogError("Choose a future time.");
  if (DateTime.fromJSDate(parsed.endAt).diff(DateTime.fromJSDate(parsed.startAt), "days").days > 366) throw new CatalogError("A time-off request can cover up to one year.");
  if (await db.timeOffRequest.count({ where: { staffId, status: "PENDING" } }) >= 10) throw new CatalogError("Wait for your pending requests to be reviewed.");
  return db.timeOffRequest.create({ data: { shopId, staffId, startAt: parsed.startAt, endAt: parsed.endAt, reason: parsed.reason, status: "PENDING" } });
}
export async function decideTimeOff(shopId: string, id: string, decision: "APPROVED" | "DECLINED") {
  z.string().min(1).max(100).parse(id); z.enum(["APPROVED", "DECLINED"]).parse(decision);
  const db = getShopDatabase(shopId);
  const request = await db.timeOffRequest.findFirstOrThrow({ where: { id } });
  return withShopTransaction(shopId, async tx => {
    const current = await tx.timeOffRequest.findFirstOrThrow({ where: { id, status: "PENDING" } });
    if (decision === "APPROVED") {
      if (current.startAt <= DateTime.utc().toJSDate()) throw new CatalogError("This time-off request has already started.");
      const overlap = { staffId: current.staffId, startAt: { lt: current.endAt }, endAt: { gt: current.startAt } };
      if (await tx.booking.count({ where: { ...overlap, status: { in: ["PENDING", "CONFIRMED"] } } })) throw new CatalogError("Reschedule or cancel existing bookings in this time before approving.");
      if (await tx.reservation.count({ where: { ...overlap, expiresAt: { gt: DateTime.utc().toJSDate() }, booking: null } })) throw new CatalogError("A customer is completing checkout for this time. Try again after the hold expires.");
    }
    return tx.timeOffRequest.update({ where: { id, status: "PENDING" }, data: { status: decision } });
  }, [request.staffId]);
}

export async function revokeTimeOff(shopId: string, id: string) {
  const current = await getShopDatabase(shopId).timeOffRequest.findFirstOrThrow({ where: { id, status: "APPROVED" } });
  return withShopTransaction(shopId, tx => tx.timeOffRequest.update({ where: { id, status: "APPROVED" }, data: { status: "REVOKED" } }), [current.staffId]);
}
