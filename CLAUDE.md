# CLAUDE.md — BookNest

## Project
Shopify embedded appointment-booking app. Multi-tenant SaaS. Merchants configure
events/services, availabilities (staff) and schedules. Shoppers book via a
storefront widget. Bookings materialise from Shopify orders.

## Stack
TypeScript (strict) · React Router 7 + Polaris + App Bridge · Prisma + PostgreSQL
· Luxon · pg-boss · Resend · Vitest · Fly.io

## Hard rules
1. NEVER use `new Date()` arithmetic for timezones. Use Luxon.
2. Store ALL timestamps UTC. Render in the viewer's IANA timezone.
3. EVERY Prisma query scoped by shopId. Enforce via middleware.
4. The availability engine is PURE — no DB calls inside.
5. Slot booking is race-safe: Postgres advisory lock + unique constraint.
6. Webhooks: verify HMAC -> dedupe -> respond 200 in under 2s -> process async.
7. Widget CSS scoped under `#bn-booking-root`. Never leak into merchant themes.
8. Write the failing test BEFORE the implementation.
9. Run `pnpm test` and `pnpm typecheck` before declaring a task done.
10. Never bump the Shopify API version mid-phase.
11. MOBILE-FIRST. Test every UI change at 480 / 768 / 1024 / 1280.
12. Use the design tokens in BUILD_GUIDE Part 5. No magic numbers.
13. Every interactive element has a minimum 44px touch target.
14. Match `docs/recon/TARGET_CONTRACT.md` for UX and payload shapes.
15. Call staff "Availabilities" in UI copy. Call services "Events/Services".

## Commands
pnpm dev · pnpm test · pnpm typecheck · pnpm db:migrate · pnpm db:studio · fly deploy

## Conventions
- `*.server.ts` for server-only modules
- Zod schemas for every external input
- ADRs in `docs/decisions/NNNN-title.md`
- Route files mirror the URL structure

## Definition of done
[ ] failing test written first, now green
[ ] pnpm test passes
[ ] pnpm typecheck passes
[ ] shopId scoping verified
[ ] responsive at 480 / 768 / 1024 / 1280
[ ] keyboard navigable, a11y >= 95
[ ] error, empty and loading states handled
[ ] deployed and manually verified on the dev store
