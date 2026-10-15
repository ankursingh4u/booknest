# Target contract

Produced by the REA extraction protocol (BUILD_GUIDE Part 7).
Target: https://yogababble.myshopify.com (Shopify demo store for the app
**"Easy Appointment Booking"** by Servicify / getservicify.com, listed at
https://apps.shopify.com/appointments-and-bookings — confirmed via the
storefront's own "Install free" links and footer).

Evidence files (this directory): `site.json`, `booking-capture.json`,
`widget-static.json`, `contracts.json`.

## Method note (read before trusting any row below)

Two REA capture passes were run with Playwright via `rea capture-browser-scenario`:

1. `site.json` — homepage (`/`) load, network+body capture enabled. The
   homepage embeds the booking widget directly (`inline_calendar`,
   `featured_service_card`, `event_collection_grid` surfaces), so a page load
   alone triggered dozens of real API calls.
2. `booking-capture.json` — product page
   `/products/glo-meditation-30-minutes` (the "Paid Booking" demo), same
   capture settings. This surface uses a `select_time_app_embed` button
   ("Select a time") that opens a popup calendar.

**Limitation, stated plainly:** every attempt to script a `click` on the
"Select a time" button (to drive the popup → pick a date → pick a time →
add-to-cart → checkout steps interactively) hung indefinitely in this REA
version/environment (confirmed reproducible across 3 attempts, including
with all capture options disabled — so it is the click action itself, not
capture overhead). The click-through flow past "button is visible and
configured" is therefore **NOT OBSERVED**. Everything below the point where
a human would click that button is reconstructed from: (a) the fully
rendered inline widget on the homepage, which exercises the *same* backend
endpoints and is already past the "pick a date/time" step, and (b) static
analysis of the widget's own JS bundle and the `/api/settings` config
payload. Where this matters, it's flagged INFERRED explicitly.

## Continuation: saved bundle inspection (2026-10-14)

**STATIC EVIDENCE, not a live request capture.** In the saved
`bundles/.../assets/embedInit.js`, `addEventToCart` constructs a Shopify
`cart/add.js` POST containing `items` (variant id, quantity, properties),
cart attributes, and requested theme sections. If temporary bookings are
enabled, it first posts quantity, event/product identifiers, selected time,
and properties to `/api/events/{id}/bookings/temporary`; its response supplies
`miniSlug` and optional `expiresAt`. Deposit bookings instead request
`/api/events/{id}/draftOrder/create` and follow its checkout URL. Free bookings
can use `/api/storefront/events/{id}/bookings` without checkout.

The interrupted retry's saved network log contains calendar analytics,
monthly availability, and busy-slot requests, but no cart or creation call.
These code paths therefore remain unverified at runtime. No browser is
connected in the Codex session. Finish the interactive capture before
Phase 5; do not promote this source inspection to OBSERVED network evidence.

## Retry repair (2026-10-14)

Inspection of Claude's saved DOM and driver found two concrete targeting bugs:
page-wide "available" matches included stylesheet text before the slot rows,
and the chosen "Book Now" control belonged to the separate floating button.
The real calendar rows are children of `.servicify-slots-scroll`; the paid
booking cart control carries `data-servicify="servicify-add-to-cart-button"`
and the saved source renders it only after selecting a time.

The calendar in the saved DOM is an ordinary modal subtree. The earlier
driver's closed-shadow-root explanation was not established as the cause of
the REA click hang. That initial hang remains undiagnosed.

A repaired runner is preserved at `scripts/recon/capture-booking.mjs`.
Ten regression tests cover real saved slot rows, irrelevant text, sold-out
and disabled rows, confirmation targeting, traversal, and capture validation.
The complete suite has 51 passing tests and TypeScript passes. The runner also
passes Node's syntax check. It uses an isolated profile/port, bounded waits,
and stops without checkout submission. Success requires a 2xx cart request
and response with matching variant/booking properties; analytics alone do not
satisfy the gate.

**Live execution is pending.** No browser is connected to this Codex session.
No new successful cart request/response was captured during the repair. Expected
output after a successful run is `booking-cart-capture.json`; partial failures
produce `retry-network-requests.json` and `retry-failure.json`. These generated
evidence files remain gitignored.

## Extracted checkout contract (saved source, 2026-10-14)

The needed checkout metadata is now extracted from `embedInit.js` and
`TockCalendarView.93925c3a.js`. This is source evidence, not a successful live
request. Machine-readable shapes and source hashes are in
`FRONTEND_CONTRACT.json`.

| Line-item property | Meaning |
|---|---|
| `_Event #` | Internal event identifier |
| `_Booking Timezone` | Effective booking timezone |
| `_Lang` | Customer locale |
| `_Start Date` | Long formatted date |
| `_Start Time`, `_End Time` | Local time strings |
| `_Booked With` | Employee name and identifier |
| `_ID` | Temporary booking miniSlug |
| `_ExpiresAt` | Hold expiry |

The source builds the employee property as name followed by identifier. Time
and date rendering use `h:mm a` and `dddd, MMMM Do YYYY`; additional localized
display properties and intake responses can be appended. `_End Date` and
`Date #` are declared constants, but this property builder does not populate
them. Paid bookings recheck availability, optionally create a temporary hold,
then submit the native cart request. Checkout completion and order-webhook
behavior remain unobserved.

Phase 0's original capture/contract gate is met. This extracted contract is
sufficient to begin Phase 1 (scaffold/auth). Live cart validation stays open
before Phase 5; mobile parity remains open before the widget UI phase.

## Endpoints

All against `https://servicify-appointments.herokuapp.com`, the app's
backend (Heroku-hosted). 19 distinct endpoint shapes were captured with real
decoded request/response bodies in `contracts.json`; the ones below are the
ones that matter for the booking flow contract. **All rows OBSERVED** (real
captured payloads, not placeholders) unless marked.

| Method | Path | Request body | Response body (shape) | Notes |
|---|---|---|---|---|
| GET | `/api/settings?storeUrl=&extensionTelemetry=1&extensionTypes=&pageType=` | — | `{ buttonText, hideAddToCartButton, hideBuyNowButton, buyNowButtonSelector, addToCartButtonSelector, frontendVersion, orderPlacedEmailTemplate, eventChangedEmailTemplate, reminderMailTemplate, ... }` | Fetched once per page type (`index`, `product`). `extensionTypes` lists which widget surfaces are active on that page. |
| GET | `/api/products/{shopifyProductId}/events?eventSlug={uuid}` or `?variantId={shopifyVariantId}` | — | Full **Event** object (see data model below) | Resolves a Shopify product/variant to the app's internal "Event" (= our "Service"). Two lookup keys observed: by `eventSlug` (homepage cards) and by `variantId` (product page, via an intermediate `/api/users/1/shopify/variants/{id}` call). |
| GET | `/api/users/1/shopify/variants/{shopifyVariantId}` | — | `{ product: { id, title, handle, images[], variants[...] } }` — live Shopify product/variant data, re-fetched server-side | Used on product pages to resolve which Event maps to the *currently selected* variant (duration option). |
| GET | `/api/storefront/users/1/events?quickResponse=true&fetchProductDetail=true` | — | Array of **all 97 Events** configured on this store, each with full field set | This is the merchant's entire service catalog, fetched for homepage grid rendering. Extremely rich — see data model section. |
| GET | `/api/events/{eventId}/nextAvailableDate?customerTimezone=UTC&startingDate=YYYY-MM-DD&numberOfDaysToReturn=3` | — | `{ nextAvailableDate: ["YYYY-MM-DD", ...] }` | Returns the next N available dates on/after `startingDate`. Used to pre-select/highlight the calendar and for "don't see a spot" messaging. |
| POST | `/api/events/{eventId}/monthly-availability` | `{ month: "YYYY-MM", timezone: "UTC", quantity: null }` | `{ "YYYY-MM-DD": { isAvailable: bool, isSoldOut?: bool, firstSlotStart?: ISO8601 } , ... }` for every day in the month | Drives the calendar grid's disabled/enabled days. One call per month shown. |
| POST | `/api/events/{eventId}/employees/busy-slots` | `{ employeeIds: [int,...], dateFrom: "YYYY-MM-DD", dateTo: "YYYY-MM-DD", inputTimezone: "UTC" }` | `{ bookings: { "{employeeId}": [ { id, quantity, employeeId, createdAt, timezone, eventId, date: { id, eventId, startDate, endDate, startTime, endTime, timezone, utcStartTime, utcEndTime, locationId, startDateString, startTimeString, endDateString } }, ... ] } }` | Per-employee existing bookings for the date range. Client-side, this is combined with each employee's `regularHours`/`specialHours` (from the Event payload) to compute free time slots — **no dedicated "get slots" endpoint was observed**; slot computation is INFERRED to happen client-side in the widget bundle, mirroring our own `computeSlots` pure-function design. |
| — (not observed) | booking creation / add-to-cart wiring | — | — | **INFERRED, not captured.** Based on `/api/settings`'s `hideAddToCartButton: true`, `addToCartButtonSelector: ".btn"`, `buyNowButtonSelector: ".shopify-payment"`: the widget hides the theme's native Add to Cart/Buy Now buttons and, after a time slot is chosen, programmatically fills Shopify's own add-to-cart form (likely with booking metadata as line-item properties) and submits it, so checkout happens on native Shopify checkout. This matches CLAUDE.md's non-negotiable #4 architecture (hidden variant + line item properties) almost exactly — the target appears to use the same approach. |

## Widget state machine

**OBSERVED** structure (from accessibility-tree capture of the homepage's
rendered widget, `site.json`, plus the network sequence):

1. **Idle / closed** — product page shows disabled-looking "Select a time"
   button until `/api/settings` + the Event lookup resolve.
2. **Popup open (product-page surface)** or **inline rendered (homepage
   surfaces)** — calendar month grid renders, days outside the fetched
   `monthly-availability` response are disabled (`[disabled]` in the a11y
   tree). Grid shows month navigation ("Previous slide"/"Next Month"),
   day-of-week headers, and marks the currently-selected day.
3. **Date selected** → triggers `busy-slots` POST for that date → time list
   renders below the grid, each slot showing remaining capacity as
   `"{available}/{total} available"` (e.g. `"1 / 3 available"`,
   `"3 / 3 available"`). A time-format toggle (`AM/PM` / `24h`) and a
   timezone indicator are always visible. A "Join the waitlist" button
   appears — **OBSERVED as present in the UI**, even though the
   BUILD_GUIDE's own v1/v2 split defers waitlist to v2. Worth a product
   decision: the target ships it in v1.
4. **Time selected** → **NOT OBSERVED** (click automation blocked, see
   Method note). INFERRED next step: add-to-cart with booking metadata as
   line-item properties, based on `/api/settings` fields.
5. **Native Shopify checkout** — INFERRED from on-page copy on the product
   page: *"Checkout and pay. Since this is a paid event, use test data:
   enter 1 as the credit card number, any name, 11/33 as the date, 111 as
   the CVV."* Confirms checkout happens on Shopify's own checkout, not a
   custom payment form.
6. **Confirmation** — INFERRED from the captured `orderPlacedEmailTemplate`
   (OBSERVED, real template string in `/api/settings`'s response): email is
   sent with `{{booking_id}}`, date/time, location, notes, and
   reschedule/cancel links (`{{reschedule_booking_link}}`) plus a bundle
   management link when applicable.
7. **Reschedule / cancel** — INFERRED to be token-based links (matches our
   own `rescheduleToken`/`cancelToken` design) from the email template
   placeholders; the actual reschedule/cancel UI was not visited.

Four distinct widget **surfaces** were observed via the `/api/settings`
`extensionTypes` query param, all backed by the same API: `select_time_app_embed`
(button + popup, product page), `inline_calendar` (calendar embedded
directly in page content), `featured_service_card` (card highlighting one
service), `event_collection_grid` (grid of multiple services) — all present
simultaneously on the homepage.

## Implied data model

**OBSERVED** — real field set from a live Event object
(`GET /api/products/{id}/events` and `GET /api/storefront/users/1/events`,
97 real examples captured). Field : inferred purpose:

- `id`, `name`, `type` (always `"employee-availability"` across all 97
  captured events — the target appears to model every booking type, paid,
  free, deposit, multi-location, bundle, etc. as the *same* underlying
  record with different field combinations switched on, not separate
  types. Matches our own single `Service` model design.)
- `productId`, `variantId`, `variants: [shopifyVariantId]` — Shopify product/variant linkage (our `Service.variantId`)
- `userId` — merchant/account owner (our `Shop`)
- `duration` (minutes), `resolution` (slot granularity, minutes), `bufferMinutes` (our `durationMin`/`bufferBefore`+`bufferAfter`)
- `numAttendees`, `minimumAttendeesPerTimeslot`, `maximumAttendeesPerTimeslot`, `capacityRules: []` (our `Service.capacity`)
- `leadTime`, `bookMinutesIntoFuture`, `customerRescheduleCutoffInHours`, `customerCancelCutoffInHours` (our `minNoticeHours`, reschedule/cancel policy — not yet modeled on our `Service`, worth adding)
- `employees: [employeeId,...]` or, when expanded, full employee objects with `regularHours` (per-weekday string ranges like `"9:00-22:00"`, empty string = closed) and `specialHours` (per-date overrides, e.g. `"2025-08-06": ["9:00-23:00"]`) — maps to our `AvailabilityRule` (regularHours) and a date-keyed override we don't currently have an equivalent for (closer to `Blackout`/`TimeOffRequest` but *additive* override hours, not just closures — **gap in our schema**, worth a follow-up ADR)
- `randomlyAssignEmployee`, `useLocationFromAssignedEmployee` — staff-assignment policy, not currently in our schema
- `lockTimezone` — the timezone a booking is fixed to regardless of the customer's local timezone
- `fixedPriceBooking`, `depositSettings: { type: "PERCENTAGE"|?, label, amount, isEnabled }` (our `Service.depositType`/`depositValue` — confirms percentage deposits are a real target feature, matches our `DepositType.PERCENT`)
- `isBundle`, `bundleSize`, `bundleExpirySettings` — packages/bundles (BUILD_GUIDE defers "packs" to v2; target has it live)
- `waitlistStatus: "disabled"|?` (BUILD_GUIDE defers waitlist to v2; target has the UI live, see state machine above)
- `canBookWithoutCheckout`, `privateAppointments`, `customerUi: "calendar"` (alternate UI modes likely exist — only `"calendar"` observed)
- `sendConfirmationNotification`/`sendReminderNotification`/`sendThankyouNotification` + matching `...Text` booleans — separate email vs SMS toggles per event (SMS is v2 in our guide; target's toggles exist even if not exercised here)
- `isGoogleMeetEnabled`, `isZoomEnabled`, `gCalTitle` — virtual-meeting integration flags (our `contactLink` is a simpler, pasted-URL equivalent per BUILD_GUIDE's explicit v1 scope decision)
- `ticketingSettings`, `upsell` — both null in every captured example; fields exist but not populated on this store (INFERRED to be real features, not observed with content)
- `slug` (uuid), `calendarColor`, `redirect_url`, `location` (free-text), `locationId`
- `shouldGateBooking`, `dailyMax`, `forceCalendarSlots`, `timeslotVisibilityMinutes`, `uniqueEventDatePerBooking`, `enableListViewForOverrideDates` — various scheduling-policy knobs without an equivalent in our current schema

**Booking record shape** (OBSERVED, from `busy-slots` response — this is
the target's existing-bookings view, not a creation payload, but the shape
is real):
```
{ id, quantity, employeeId, createdAt, timezone, eventId,
  date: { id, eventId, startDate, endDate, startTime, endTime, timezone,
          utcStartTime, utcEndTime, locationId,
          startDateString, startTimeString, endDateString } }
```
Notably: both a human-readable `startTime`/`endTime` ("6:00 am") AND
UTC ISO fields are stored — consistent with our own "store UTC, render
local" rule, but the target also keeps the original local strings (worth
considering for display-without-reconversion edge cases, e.g. DST).

## Third-party libraries detected

**OBSERVED**, from static analysis of the exported widget bundle
(`widget-static.json`; source files in `bundles/files/origins/.../extensions/01a135f9-d5f2-7825-84bb-93a391eaba83/digital-appointments-573/`):

- The widget ships as a genuine **Shopify theme app extension**
  (extension id `01a135f9-d5f2-7825-84bb-93a391eaba83`, named
  `digital-appointments-573`), served from `cdn.shopify.com/extensions/...`
  — confirms CLAUDE.md's non-negotiable "theme app extension not
  ScriptTags" matches the real target's architecture, not just our own
  preference.
- Entry bundle `embedInit.js` (~470KB) + code-split chunks
  `TockCalendarView.*.js` (4 separate hashed builds — likely per-surface
  variants of the calendar component for the 4 extension types above),
  `EventList.js`, `en.js` (locale strings — i18n scaffolding present even
  if only English was observed).
- `react-day-picker` confirmed by literal string match in both
  `embedInit.js` and `TockCalendarView.5f81c6f3.js` — the calendar grid UI
  library.
- 154 JS files parsed total (887 static findings, ~716K AST nodes) across
  the full page load, most unrelated to the booking widget (Shopify's own
  theme JS, `Seal Subscriptions` app, analytics). No other
  booking-specific third-party library was identified by string search
  (no `flatpickr`, `moment`, `luxon`, `dayjs` literal matches in the widget
  files specifically — date handling is likely hand-rolled or bundled
  under a renamed/minified identifier; **INFERRED** gap, not confirmed
  absent).

## UX details

**OBSERVED** (exact copy from the accessibility-tree capture):
- Button label: `"Select a time"`
- Demo banner (site-wide): `"This is a live demo store. Checkout is in
  test mode, so nothing is charged."`
- Product page instructional copy (paid-booking demo):
  `"#1. Click "Select a Time" ... #2. A popup will show you dates & time.
  Select a time. #3. Checkout and pay. Since this is a paid event, use
  test data: enter 1 as the credit card number, any name, 11/33 as the
  date, 111 as the CVV"`, `"You will receive an email saying everything
  you need to know about your booking!"`
- Calendar: disabled days rendered as non-interactive grid cells; selected
  day marked `[selected]`; month navigation via `"Next Month"` button (no
  observed "Previous Month" on this view — only `"Previous slide"` which
  belongs to an unrelated homepage carousel).
- Time slots: text format `"{h}:00 {AM/PM} {available} / {total}
  available"`, e.g. `"1:00 PM 1 / 3 available"`.
- Time format toggle: two buttons, `"AM/PM"` (observed `[pressed]`,
  i.e. default) and `"24h"`.
- Timezone indicator: an icon labelled `"current timezone"` next to text
  `"Timezone: UTC"` (reflects the browser's detected timezone, not a fixed
  store timezone).
- Empty/edge state: `"Don't see a spot available?"` → `"Join the
  waitlist"` button, shown even when slots exist for the visible date (so
  it's likely always-present, not conditional on sold-out — **INFERRED**).
- Validation/loading states: **not observed** — would require the blocked
  interactive flow.

## Responsive behaviour

**Not independently observed.** Both captures ran at a single 1280×800
desktop viewport (`environment.viewport` in the scenario config is the only
exposed knob for this in the REA tool actually used; no second mobile-width
pass was completed within this session's time budget). This is a real gap:
BUILD_GUIDE Part 5 requires our own widget to verify 480/768/1024/1280, and
we have zero direct evidence of how the *target* adapts at those
breakpoints. **INFERRED only**, from `react-day-picker`'s known behavior and
the BUILD_GUIDE's own mobile-first spec (bottom-sheet popup, horizontal-
scroll week strip under 768px) — do not treat this section as validated
against the target; re-run a mobile-viewport capture before relying on it.

## OBSERVED

- All endpoint rows in the Endpoints table except the explicitly marked
  "not observed" row — real captured request/response bodies, cited above
  inline. Raw evidence: `contracts.json`, `site.json`, `booking-capture.json`.
- Full 97-event service catalog and its field schema — `contracts.json`,
  endpoint `GET /api/storefront/users/1/events`.
- Widget surface structure, calendar/time-slot UI copy and rendered slot
  lists before interactive time selection — `site.json` accessibility-tree artifact.
- Theme app extension architecture, bundle names, `react-day-picker` —
  `widget-static.json` + raw files under `bundles/`.
- App identity ("Easy Appointment Booking" / Servicify) — footer links and
  Install-free URLs in both captures' accessibility trees.

## INFERRED

- Booking creation / add-to-cart payload shape — not captured; reasoned
  from `/api/settings` button-hiding config only. **Needs validation**
  before Phase 5 (checkout/webhooks) implementation decisions lean on it.
- Slot computation happening client-side (vs. a server endpoint we simply
  didn't trigger) — reasoned from the absence of any "get available slots"
  endpoint in 19 captured endpoint shapes across two full page loads.
- Post-purchase booking materialization via order webhook — architectural
  assumption carried over from our own CLAUDE.md design, not observed on
  the target.
- Reschedule/cancel flow being token-link based — reasoned from email
  template placeholders only; UI not visited.
- All responsive/mobile behaviour (see dedicated section above).
- Validation rules, loading states, and error states for the booking
  popup — entirely unobserved due to the click-automation blocker.

## Known gaps / follow-up before Phase 3+

1. Re-attempt the interactive click-through (date → time → add-to-cart →
   checkout) with either a different REA version, a manually-driven
   browser session, or Playwright directly outside REA — the `click`
   action hang in `capture-browser-scenario` blocked the single most
   important part of the flow (booking creation payload).
2. Re-run both captures at a 375px/480px mobile viewport to fill the
   Responsive behaviour section with real evidence.
3. Two schema gaps surfaced that we don't currently model: per-date
   *additive* availability overrides (target's `specialHours`, distinct
   from our `Blackout` which only subtracts) and reschedule/cancel cutoff
   windows (`customerRescheduleCutoffInHours`/`customerCancelCutoffInHours`).
   Worth an ADR before Phase 2 (data model) is considered final.
