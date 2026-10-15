# ADR 0001 — Availability engine design

Status: accepted

## Context
Slot availability must be correct across timezones, DST transitions, buffers,
blackouts, capacity and booking collisions.

## Decision
The engine is a PURE function. No DB, no fetch, no clock reads — `now` is injected.
Signature: computeSlots(input: ComputeSlotsInput): Slot[]

Pipeline: expandRules -> subtractBlackouts -> subtractBookingsAndBuffers
-> applyNoticeWindows -> applyCapacity -> toUtc.

All output is UTC. Rule times are local to the rule's timezone, expanded with
Luxon so a 09:00 rule stays 09:00 local across a DST boundary.

## Required test cases
1. basic weekly expansion over 7 days
2. DST spring-forward, America/New_York
3. DST fall-back, America/New_York
4. southern hemisphere DST, Australia/Sydney
5. half-hour offset timezone, Asia/Kolkata
6. blackout fully inside a day
7. blackout overlapping a slot boundary
8. booking plus buffer collision
9. minNotice exclusion
10. maxAdvance exclusion
11. capacity greater than 1, partial fill
12. back-to-back bookings with zero buffer
13. rule spanning midnight
14. time-off request overlapping a rule

## Race safety (outside the engine)

Take PostgreSQL transaction advisory locks for every affected (shopId, staffId),
in stable sorted order. Locking the entire Availability also covers overlaps
between different start times and services. Re-read bookings and unexpired
reservations while holding the lock, then write the hold or booking.

The old unique(staffId, startAt, status) constraint was removed because it
incorrectly forbids group bookings and does not prevent overlapping intervals.
Unique shop/idempotency keys, reservation-to-booking identity, and order-line
identity prevent duplicate requests and webhook conversions. Quantity and time
ordering have SQL check constraints.

21 pure-engine tests pass. Two opt-in PostgreSQL tests exercise 20 competing
holds and 20 retries of one booking. They are not yet run against a database.

Paid conversion and order cancellation share a shop/order advisory lock.
Order locks are acquired before Availability locks to prevent lock-order
deadlocks. Cancellation waits for any in-flight paid conversion before reading
bookings; the durable cancellation receipt prevents subsequent paid conversions
from confirming the order. Booking mutations also compare the current status,
Availability, and start time so a stale reschedule cannot revive a cancellation.
