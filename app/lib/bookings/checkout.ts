import { DateTime } from "luxon";
export function paymentDue(service: { priceCents: number; depositType: string; depositValue: number }) {
  const due = service.depositType === "FIXED" ? service.depositValue
    : service.depositType === "PERCENT" ? Math.round(service.priceCents * service.depositValue / 100) : service.priceCents;
  if (!Number.isSafeInteger(due) || due < 0 || due > service.priceCents || service.priceCents > 0 && due === 0) throw new Error("Invalid payment amount");
  return due;
}
export function reservationProperties(hold: { id: string; serviceId: string; startAt: Date; endAt: Date; expiresAt: Date }, timezone: string, staffName: string) {
  const start = DateTime.fromJSDate(hold.startAt).setZone(timezone).setLocale("en");
  const end = DateTime.fromJSDate(hold.endAt).setZone(timezone).setLocale("en");
  return { "_BookNest Reservation": hold.id, "_Event #": hold.serviceId, "_Booking Timezone": timezone, "_Lang": "en",
    "_Start Date": start.toFormat("cccc, LLLL d yyyy"), "_Start Time": start.toFormat("h:mm a"), "_End Time": end.toFormat("h:mm a"),
    "_Booked With": staffName, "_ID": hold.id, "_ExpiresAt": hold.expiresAt.toISOString() };
}
