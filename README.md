# BookNest

Shopify appointment booking with an embedded merchant app, a storefront theme block, and a limited-access Team Portal.

## Implementation status — 15 October 2026

The local implementation includes:

- Shopify authentication, persistent SDK sessions, verified shop identity, and tenant-scoped database access.
- Locations, Availabilities, Events/Services, weekly hours, date-specific additional hours, closures, intake questions, and notification templates.
- A pure Luxon scheduling engine covering DST, overnight hours, buffers, capacity, notice windows, time off, configurable slot intervals, and expiring holds.
- Inline/popup storefront booking, featured service cards and collections, custom month/week calendars, timezone and AM/PM controls, three themes, free booking, native Shopify cart checkout, and deposit draft orders.
- Shopify variant selection, owned booking-product creation/publication, linked-variant checkout controls, and safe cart retries.
- Customer cancellation/reschedule cutoffs revalidated under booking locks.
- Durable webhook processing, payment reconciliation, merchant recovery for reviewed payments, customer reschedule/cancel, and email reminders.
- Google Calendar OAuth, encrypted refresh tokens, live busy-time checks, and idempotent appointment synchronization.
- List, Agenda, Calendar, and Availability views; filters, configurable details, CSV export, manual booking, check-in, and guided setup.
- One-use Team Portal invitations, revocable sessions, assigned-Availability access, and time-off approval.
- Aggregate booking insights with an optional daily Anthropic summary and a deterministic fallback.
- Shopify-hosted plan management, Partner API subscription verification, and consented monthly team-seat metering.

**Verified locally:** 298 tests pass; TypeScript and Prisma schema validation pass. Two PostgreSQL concurrency tests are skipped until an isolated test database is supplied. Migration SQL is generated, not applied. No production build, live integration, responsive visual review, or deployment has been completed in this environment.

## Local setup

Use Node 22.19+ and the pnpm version pinned in package.json.

1. Install dependencies with `pnpm install --no-frozen-lockfile`. This must regenerate the currently stale lockfile.
2. Copy `.env.example` to `.env` only if a local environment file does not already exist. Fill runtime credentials without committing them.
3. Run `pnpm prisma generate`.
4. Apply `pnpm db:deploy` only to the intended isolated BookNest database.
5. Run `pnpm dev` with Shopify CLI, or `pnpm dev:web` for the web server.
6. Run `node --env-file=.env --import tsx app/worker.server.ts` alongside the web server for webhooks, notifications, calendar updates, and seat billing.

Production is intended for the user's existing Coolify VPS at **booknestapp.site**, using a separate BookNest app and PostgreSQL database. Leave all other hosted apps and databases unchanged.

## Direct Coolify deployment

The ignored local environment file already contains the recovered Coolify token and resource IDs. Runtime credentials stay out of the source package. Run from the BookNest app directory:

```text
node scripts/package-release.mjs
node --env-file=.env scripts/deploy-coolify.mjs
node --env-file=.env scripts/deploy-coolify.mjs --execute
```

Preparation writes `.cache/deployment/Dockerfile.coolify`: a standalone Dockerfile carrying the secret-free source archive in bounded chunks. Execution verifies the live project, environment membership, server and isolated database; creates only the BookNest application if absent; installs runtime variables; starts only booknest-db if stopped; and deploys one verified application UUID. Coolify performs dependency installation, build and migration on the server. It never modifies server keys, proxy settings, other apps, or shared variables.

The script saves application/deployment IDs and reports success only after the deployment finishes and the public BookNest health endpoint responds. Shopify app/extension publication and live integration acceptance remain separate steps. Existing apps with a different inline source release require updating the generated Dockerfile and source description in Coolify before resuming; the current API does not permit safe inline Dockerfile updates. See [deployment decision](docs/decisions/0003-coolify-direct-source-release.md).

## Verification

```text
pnpm test
pnpm typecheck
pnpm prisma validate
pnpm build
node --env-file=.env scripts/check-release.mjs
```

The release check reports configuration presence and local artifacts; it does not validate credentials or claim live readiness.

For database race tests, create and migrate a disposable PostgreSQL database whose name is `booknest_test` or `booknest_test_...`. Set `BOOKNEST_TEST_DATABASE_URL` explicitly, then run `pnpm exec vitest run tests/integration/booking-race.test.ts`. The tests create and delete only their uniquely identified shop fixtures. They never fall back to the app's DATABASE_URL.

Recent release fixes cover streamed React Router loader data, appointments crossing midnight, order-first cancellation locking, stale booking updates, shop-wide closure deletion, and Docker's pnpm build policy.

Create the source handoff with `pnpm package:release`. It writes `.cache/deployment/booknest-source.tar.gz` and a SHA-256 manifest, excludes runtime environment files, and rejects source containing known local runtime secrets. This is a source package; it does not contain a production build.

## Billing setup

Configure Free ($0), Standard ($15), Pro ($29), and Pro Plus ($39) monthly plans in Shopify App Pricing. Set the welcome path to `/app/billing`. The subscription item handles must match the four `SHOPIFY_PLAN_*_HANDLE` variables. Plan redirect query parameters never grant access.

Set `SHOPIFY_PARTNER_ORG_ID` and `SHOPIFY_PARTNER_API_TOKEN` for a Partner client with Manage apps access. Verify every plan on a development store before setting `BILLING_ENFORCEMENT=true`. Admin and Partner APIs remain pinned to 2026-07.

For Team Portal billing, configure a fixed-price monthly usage meter at **$8 USD per seat**, with no included units, matching `SHOPIFY_TEAM_SEAT_METER_HANDLE`. Verify billing events in Shopify's Dev Dashboard before setting `TEAM_SEAT_BILLING_ENABLED=true`. The separate App Events endpoint currently uses Shopify's documented `unstable` endpoint; it does not change the Admin API version.

A consented active seat produces one usage record per billing cycle. Charges are not prorated; revocation stops future-cycle usage. Existing test seats require renewed merchant consent. Trial periods without a billing cycle do not generate seat usage. Provider transport acceptance is not proof that Shopify accepted an event as billable; inspect the Dev Dashboard.

The brief gives tier prices but no feature-limit matrix. No arbitrary per-tier booking/resource limits have been invented. Confirm that matrix before marketing distinct plan entitlements.

References: [Shopify App Pricing](https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing), [Partner active subscription](https://shopify.dev/docs/api/partner/2026-07/active-subscription), [billing events](https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing/subscription-billing/build-billing-event).

## Email, calendar, and insights

- Configure Resend with a verified EMAIL_FROM. The worker handles confirmation, reschedule, cancellation, and 24-hour/1-hour reminders. Support exposes failed deliveries for retry.
- Register Google's redirect URI as `https://booknestapp.site/auth/google/callback`. Keep SESSION_SECRET stable: it encrypts refresh tokens and signs team sessions. Connect calendars from the merchant's Google Calendar page.
- Calendar reads exclude matching BookNest events to avoid double-counting group capacity. External calendar edits block availability; they do not automatically reschedule BookNest appointments.
- Set ANTHROPIC_API_KEY to enable daily AI summaries; ANTHROPIC_MODEL is configurable. Only aggregate counts and amounts are sent. Without it, metrics and a clearly labeled deterministic summary work.
- Deposit checkout collects the configured deposit. Remaining balances and refunds are handled by the merchant through Shopify; no automatic remaining-balance charge or refund is claimed.

## Remaining release gates

1. **Build access:** @react-router/dev, @react-router/serve, and Vite are declared but not installed locally. Package network access is denied. Regenerate the lockfile online, run the build, and restore `--frozen-lockfile` in Docker before a reproducible release.
2. **Deployment access:** the saved Coolify token and exact BookNest project/environment/server/database IDs are recovered and configured locally. Direct HTTPS requests currently fail with EACCES before a server response; native Windows clients also cannot connect. The direct-source deployment script is prepared; no Coolify changes, live migrations, or deployment have occurred. GitHub push access is not required by that script.
3. **External configuration:** confirm the development-store domain, Shopify credentials, Partner API/hosted plans/meter, sender verification, Google consent/redirect, and optional AI key. Existing local credential presence does not prove validity.
4. **Integration verification:** run isolated database race tests and live OAuth, free/full/deposit booking, webhook retries, cancellation/refund review, email, Google Calendar, and billing tests.
5. **UI acceptance:** inspect 480 / 768 / 1024 / 1280 layouts, keyboard access, and accessibility. No browser surface was available. The widget now has a custom month calendar/week strip and keyboard controls; exact visual parity with the reference has not been verified.
6. **Onboarding acceptance:** guided setup, variant selection, and automatic owned-product creation/publication are implemented. Publish the Shopify app configuration and theme extension, reauthorize the publication scopes, enable the theme blocks, and verify a storefront booking. Automatic theme-install verification remains pending.

The runtime Docker image starts the web server and durable worker together and runs migrations first. The process supervisor stops both children if either fails. Do not treat local tests as a launch approval.
