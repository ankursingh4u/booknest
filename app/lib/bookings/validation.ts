import { z } from "zod";
import { DateTime } from "luxon";
export const reservationInput = z.object({
  serviceId: z.string().min(1).max(100), staffId: z.string().min(1).max(100),
  startAt: z.string().datetime({ offset: true }).refine(value => DateTime.fromISO(value).isValid).transform(value => DateTime.fromISO(value).toUTC().toISO()!),
  quantity: z.coerce.number().int().min(1).max(1000).default(1), idempotencyKey: z.string().uuid(),
});
export const customerInput = z.object({
  email: z.string().trim().email().max(254), name: z.string().trim().min(1).max(200),
  phone: z.string().trim().max(50).optional(), notes: z.string().trim().max(2000).optional(),
  answers: z.array(z.object({ questionId: z.string().min(1).max(100), value: z.string().trim().max(2000) })).max(100).default([]),
});
export type ReservationInput = z.infer<typeof reservationInput>;
export function matchesReservation(record: { serviceId: string; staffId: string; startAt: Date; quantity: number }, input: ReservationInput) {
  return record.serviceId === input.serviceId && record.staffId === input.staffId && record.quantity === input.quantity
    && record.startAt.getTime() === DateTime.fromISO(input.startAt).toMillis();
}
export class BookingError extends Error {
  constructor(message: string, public readonly status = 409) { super(message); }
}
