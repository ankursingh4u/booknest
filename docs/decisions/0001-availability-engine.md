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
Postgres advisory lock on (staffId, startAt) plus a unique constraint on
(staffId, startAt, status) for active statuses.
