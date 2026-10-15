# CLAUDE.md — BookNest

## Project
Shopify embedded appointment-booking app. Multi-tenant SaaS. Merchants configure
events/services, availabilities (staff) and schedules. Shoppers book via a
storefront widget. Bookings materialise from Shopify orders.

## Stack
TypeScript (strict) · React Router 7 + Polaris + App Bridge · Prisma + PostgreSQL
· Luxon · pg-boss · Resend · Vitest · Coolify

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
pnpm dev · pnpm test · pnpm typecheck · pnpm db:deploy · pnpm db:studio

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

## Continuation status (2026-10-15)

- The user explicitly requested taking over Claude's work, proceeding from available evidence, and completing the app. Do not restart extraction or repeat blocked setup attempts.
- Hosting override: existing Coolify VPS, isolated BookNest app/database, app.booknestapp.live. Leave other apps alone.
- Phase 0 contract committed as 296030f. Static bundle evidence is extracted; interrupted live cart capture never completed.
- Core implementation now spans auth, tenant access, catalog/schedules, availability, storefront checkout, webhooks, customer portal, notifications, calendar, booking views/export, Team Portal, insights, and hosted-plan/seat billing. See README for exact scope and release gaps.
- 298 tests pass. TypeScript and Prisma validation pass. Two PostgreSQL race tests require BOOKNEST_TEST_DATABASE_URL and are skipped. Coverage percentage and browser accessibility are not measured.
- Shopify session and booking/calendar/team/billing migrations are generated but have not been applied to any live database.
- Shopify credentials are present in the ignored local environment file, extracted from the supplied history; they have not been live-validated. Never print or copy secrets into tracked files or notes.
- Build is blocked by missing @react-router/dev, @react-router/serve, and Vite plus denied package network access. pnpm-lock.yaml needs regeneration. Docker temporarily uses --no-frozen-lockfile; restore frozen installation after regeneration.
- The saved Coolify token and exact isolated BookNest resource IDs are configured in ignored .env. Direct deployment script is implemented and mocked. Node HTTPS fails EACCES; native clients also cannot connect. No push, deployment, live migration, or browser verification has occurred. GitHub connector is read-only; direct-source Coolify deployment does not need GitHub.
- Billing enforcement and seat metering remain disabled until hosted plans, Partner API access, and the monthly $8 usage meter are configured and verified. No feature-limit matrix was supplied; do not invent one.
- Admin and Partner API version remains 2026-07. App Events uses its separately documented unstable endpoint.
- Existing tests use installed local packages and can run directly through Node when shell execution is unavailable. Avoid repeated shell, network, or browser setup loops.

- Latest parity work adds owned Shopify product creation/publication, custom calendar/week controls, viewer timezones, current variant binding and checkout gating, safe paid cart retry, slot intervals, customer cutoffs under locks, and additional date-specific hours. Extra hours are explicit additive windows; exact original override semantics were not observed.
- Deployment: node scripts/package-release.mjs, then node --env-file=.env scripts/deploy-coolify.mjs --execute. The preparation mode omits --execute. No deployment credentials enter the source archive or app container.
