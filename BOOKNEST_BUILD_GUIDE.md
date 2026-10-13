# BOOKNEST_BUILD_GUIDE.md

> BookNest — Appointment Booking & Scheduling for Shopify. Read Part 0 first.

# CONTENTS
0 How to use · 1 Product definition · 2 Target intelligence · 3 APIs and
credentials · 4 Architecture · 5 Design system and responsiveness · 6 Data model
· 7 REA extraction protocol · 8 Environment setup · 9 CLAUDE.md · 10 File tree
· 11 Phase prompts · 12 Cost · 13 Resources · 14 Failure modes · 15 Tracker

---

# PART 0 — HOW TO USE

Order matters. Do not reorder.
1. Read Parts 1-6 once.
2. Complete Part 3 (credentials).
3. Run Part 7 (REA extraction) — this is Phase 0.
4. Execute Part 11 phases in order, one at a time.
5. Between phases: /clear, git commit, fly deploy, visual parity check.

Claude Code: plan mode for every phase start and schema change; TDD loop for the
engine (spec -> failing test -> implement -> green); /clear between phases.

Two absolute rules: failing test before implementation; responsive at every
breakpoint before a phase is called done.

---

# PART 1 — PRODUCT DEFINITION

Name BookNest. Listing title "BookNest — Appointment Booking & Scheduling for
Shopify". Slug booknest. Category Event booking.

BookNest is a thin scheduling layer over Shopify's commerce primitives. Bookings
flow through native checkout so payments, tax, multi-currency, refunds, deposits
and POS come free.

Users: merchant owner, staff ("Availability"), front desk, customer, POS operator.

v1: multi-location; events with duration/buffers/capacity/price/deposits;
availability rules, blackouts, time-off; DST-proof engine; storefront widget;
native checkout to booking; intake questions; email notifications; self
reschedule and cancel; Google Calendar sync; availability profiles with Contact
Link; manual bookings; bookings in 4 views; check-in and hide-checked-in; CSV
export; AI insights card; Team Portal seats; 4-tier billing; full responsive;
WCAG 2.1 AA.

v2 deferred: waitlist, packs, QR tickets, POS extension, SMS, Outlook, Zoom API,
Klaviyo, Flow, advanced reporting, auto refunds, Customer Account extension.

Tiers: Free 0, Standard 15, Pro 29, Pro Plus 39, Team Portal 8 per seat.

---

# PART 2 — TARGET INTELLIGENCE

From the founder walkthrough (youtu.be/1QRgfJw2n7A) and admin screenshots.

Setup wizard: store/language -> event type -> free or paid -> name -> duration
-> group or private -> schedule -> tie to new or existing product -> create
calendar -> enable in theme -> auto-verify -> preview.

Admin nav: Bookings, Availabilities, Account, Settings, Intake Questions,
Waitlist, Support. Call staff "Availabilities" in UI.

Bookings page: Refresh, Add a booking, view tabs List/Agenda/Calendar/Availability,
AI insights card, timezone viewer, status tabs Upcoming/Recently booked/
Cancelled/All/Export, search by name/email/id/order, filters, Hide checked-in,
Columns config, row actions reschedule/cancel/check-in.

Availability profile fields: first name, last name, email, phone, Contact Link,
location, image URL, description. Contact Link is a pasted meeting URL, so the
Zoom API is not needed in v1.

Settings IA is 4 card groups: Storefront, Connected apps, Customer experience,
Developer. Plan-gated cards show an "Unlock on higher plan" badge.

---

# PART 3 — APIs AND CREDENTIALS

Scopes: read_products, write_products, read_orders, write_orders,
read_draft_orders, write_draft_orders, read_customers, write_customers,
read_locations. GDPR webhooks: customers/data_request, customers/redact,
shop/redact.

Must have: Neon (DATABASE_URL, DIRECT_URL), Fly.io, Resend (key + verified
domain), Google Cloud (Calendar API, OAuth web client), domain.
Strongly recommended: Sentry DSN, Anthropic key.
v2 only: Twilio, Azure, Zoom, Klaviyo.

Seven credentials give a fully functional submittable v1.

---

# PART 4 — ARCHITECTURE

Surfaces: Admin (React Router 7 + Polaris + App Bridge), Storefront (theme app
extension). Backend Node.js on Fly.io. Services: auth, billing, availability
engine, booking service, notify worker, calendar sync. Data: Postgres on Neon via
Prisma, pg-boss queue.

Non-negotiables: theme app extension not ScriptTags; native checkout via hidden
variant plus line item properties; store UTC render IANA; Luxon everywhere;
advisory locks plus unique constraint; pg-boss not Redis; webhooks verify,
dedupe, 200 fast, async; every query scoped by shopId; Fly not Vercel; Shopify
App Pricing; widget CSS scoped under one root id; mobile-first.

---

# PART 5 — DESIGN SYSTEM AND RESPONSIVENESS

Breakpoints sm 0-479, md 480-767, lg 768-1023, xl 1024-1279, 2xl 1280+.
Tokens: space 4/8/12/16/24/32; radius 6/10/16; font 12/14/16/20/28; touch 44px.
No magic numbers.

Admin responsive: sidebar rail -> icons -> hamburger drawer under 768; IndexTable
-> card list under 768; modals -> full-screen sheet under 768; settings 3/2/1
columns; filters behind a button; sticky bottom bar for bulk actions.

Widget responsive: container 100% under 768 with 16px gutter, 560px centered
above; popup becomes a bottom sheet under 768 with swipe-to-close; week calendar
horizontal scroll strip under 768, 7-column grid above; slot grid 1 column with
48px rows under 768, 3 columns above; sticky full-width CTA under 768.

Accessibility: keyboard reachable, visible focus rings, arrow-key slot
navigation, aria-live announcements, 4.5:1 contrast, labelled inputs, modal
focus trap, prefers-reduced-motion, 200% zoom, VoiceOver and NVDA tested.

Budgets: widget JS under 30KB gz, CSS under 8KB gz, LCP under 2.5s on 4G,
admin TTI under 1.5s, API p95 under 300ms, Lighthouse a11y 95+.

Visual parity: run REA against your app and the target at the end of every UI
phase, then diff structure, states and copy.

---

# PART 6 — DATA MODEL

17 models in prisma/schema.prisma. Key constraints: unique (staffId, startAt,
status) on Booking for race safety; unique (shopId, slug) on Service; unique
(shopId, forDate) on InsightsSnapshot.

---

# PART 7 — REA EXTRACTION PROTOCOL (PHASE 0)

Install: npx rea-agents setup, then claude mcp add shopify-dev.
Capture: analyze-website on the target demo store -> site.json; manual DevTools
capture -> bundles/ and booking.har; analyze-javascript-application ./bundles ->
widget-static.json; analyze-network-capture ./booking.har -> contracts.json.
Synthesize into docs/recon/TARGET_CONTRACT.md (endpoints, state machine, implied
data model, third-party libraries, UX details, responsive behaviour, OBSERVED vs
INFERRED).
Exit gate: all four artefacts produced, contract written, endpoints documented
with real payloads, state machine mapped, OBSERVED and INFERRED separated.
Limits: you clone the frontend contract only.

---

# PART 8 — ENVIRONMENT SETUP

Node 22.19+, pnpm, Shopify CLI, flyctl, Claude Code. .env.example and
shopify.app.toml are in the repo. API version pinned to 2026-07. .mcp.json
registers rea and shopify-dev project-wide.

---

# PART 9 — CLAUDE.md

See CLAUDE.md. Fifteen hard rules on timezones, shopId scoping, purity, race
safety, webhooks, CSS isolation, TDD, responsive testing, touch targets, naming
and API versioning.

---

# PART 10 — FILE TREE

app/routes (admin, webhooks, public api, proxy); app/lib (availability, booking,
calendar, insights, notify, shopify); app/jobs; app/components (ResponsiveTable,
ResponsiveModal, EmptyState); extensions/booking-widget; docs/recon;
docs/decisions; docs/parity; prisma.

---

# PART 11 — PHASE PROMPTS

Phase 1 scaffold, auth, deploy. Phase 2 data model and admin CRUD.
Phase 3 availability engine (TDD, 14 cases, 95% coverage).
Phase 4 storefront widget (mobile-first, 3 themes, zero CSS leak).
Phase 5 checkout and webhooks (20-concurrent race test).
Phase 6 notifications. Phase 7 Google Calendar sync.
Phase 8 bookings views, check-in, export. Phase 9 AI insights card.
Phase 10 billing, compliance, launch.

Each phase ends with: green tests, typecheck, 4 breakpoints verified, deployed.

---

# PART 12 — COST

Setup about 15 USD. Monthly about 108-165 USD including Claude Code Max, Fly.io,
Neon, Resend, Anthropic and domain. Shopify takes 0% of the first 1M USD per
year, 15% after.

---

# PART 13 — RESOURCES

REA https://github.com/morluto/rea and https://howtorea.com/
Template https://github.com/Shopify/shopify-app-template-react-router
App Store requirements https://shopify.dev/docs/apps/launch/shopify-app-store/app-store-requirements
Billing https://shopify.dev/docs/apps/launch/billing
Theme app extensions https://shopify.dev/docs/apps/build/online-store/theme-app-extensions
Polaris https://polaris.shopify.com
Target listing https://apps.shopify.com/appointments-and-bookings
Target demo https://yogababble.myshopify.com
Target walkthrough https://youtu.be/1QRgfJw2n7A
pg-boss https://github.com/timgit/pg-boss
Luxon https://moment.github.io/luxon/

---

# PART 14 — FAILURE MODES

1 Timezone and DST bugs. 2 Slot race conditions. 3 CSS leaking into themes.
4 Broken mobile admin. 5 Scope creep. 6 Skipping Phase 0. 7 Missing GDPR webhooks.

---

# PART 15 — TRACKER

[ ] Part 3 credentials
[ ] Phase 0 extraction
[ ] Phase 1 scaffold
[ ] Phase 2 data model
[ ] Phase 3 engine
[ ] Phase 4 widget
[ ] Phase 5 checkout
[ ] Phase 6 notifications
[ ] Phase 7 calendar
[ ] Phase 8 bookings views
[ ] Phase 9 insights
[ ] Phase 10 launch

One phase at a time. /clear between phases.
