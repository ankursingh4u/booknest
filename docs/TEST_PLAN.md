# BookNest — Test Plan

_Last updated: 24 October 2026_

End-to-end test plan covering install, setup, storefront booking, checkout, dashboard, Google
Calendar sync, emails, lifecycle, and compliance. Use it for pre-submission verification, the demo
recording, and as reviewer notes for the Shopify App Store.

## Environment & prerequisites

| Item | Value / note |
|---|---|
| Dev store | `test1booknest.myshopify.com` (storefront is password-protected) |
| App URL | `https://app.booknestapp.site` |
| Test payments | Shopify **Bogus Gateway** — card number `1` (success), name `Bogus Gateway`, any future expiry, any CVV |
| Customer inbox | Use a real inbox you control so you can verify confirmation emails |
| Google account | Must be a **test user** on the OAuth consent screen (app is in Testing mode) to connect Calendar |
| Emails | Resend sending domain `mail.booknestapp.site` is **verified** |

Reopen the app from **Apps → BookNest** (not an in-app refresh) after any deploy to load the latest build.

## 1. Install & setup

| ID | Steps | Expected |
|---|---|---|
| S1 | Install the app on a fresh store | App opens embedded, no errors; a default Location and an Availability (Mon–Fri 9–5) are auto-created |
| S2 | Open **Settings** | Store timezone + reply email are prefilled from Shopify; Google Calendar card is present |
| S3 | Open the **Setup** guide | Two steps: Confirm store preferences, Create your first Event/Service, then Add the booking widget |

## 2. Catalog (Events/Services, Availabilities)

| ID | Steps | Expected |
|---|---|---|
| C1 | Events/Services → **+ Create** → complete the wizard (paid, duration, capacity, price, pick Availability, create/link product) | Service created; redirected to its edit view; "✓ Already linked to a Shopify product" |
| C2 | Create a **free** service (choose Free in the wizard) | No product required; saves successfully |
| C3 | Edit a service → change price/duration → **Save changes** | "Changes saved"; values persist |
| C4 | Record list cards | Title is a button, status badge, clean ID chip, Archive action in its own row |
| C5 | Archive then Restore a service (Active/Archived tabs) | Moves between tabs correctly |
| C6 | Availabilities → a record shows **Set working hours** / connected status | Opens Schedules; hours editable |

## 3. Storefront widget & booking

| ID | Steps | Expected |
|---|---|---|
| W1 | Add the booking block to the product in the theme editor → Save | Block appears on the product page |
| W2 | Open the product on the storefront | **One** "Select a booking time" button replaces Add to cart / Buy now (not two) |
| W3 | On an **unlinked** product | Normal buy button shows; no BookNest text |
| W4 | Select a time: date → time → guests | Only available slots show; Add to cart appears after picking |
| W5 | Click **Add to cart** | Reservation is held; cart has the booking line with reservation properties |
| W6 | Waitlist (pick a day with no slots) → Join waitlist | Email field works, submits without blocking the page |

## 4. Checkout → confirmed booking

| ID | Steps | Expected |
|---|---|---|
| O1 | Checkout with a real customer email + Bogus Gateway card `1` | Order completes |
| O2 | Within ~1 min, open **Bookings** | Booking shows **CONFIRMED** with the customer name/email, service, time |
| O3 | Free booking (no checkout) | Created immediately as CONFIRMED after entering name/email |
| O4 | Confirmation **email** | Customer inbox receives the BookNest confirmation from `bookings@mail.booknestapp.site` |

## 5. Dashboard & views

| ID | Steps | Expected |
|---|---|---|
| D1 | Bookings → **List** | Booking cards: tidy detail lines + aligned action row (Check in / Reschedule / Complete / No-show) |
| D2 | **Agenda** / **Availability** views | Group by day / by Availability correctly |
| D3 | **Calendar** view | Days are colour-coded: 🟩 green <50% booked, 🟨 amber 50–99%, 🟥 red full, ⬜ grey closed/past; legend shown |
| D4 | Filter by Status / Availability / Event-Service + search | Results filter live; Clear filters resets |
| D5 | **Export matching bookings** | CSV downloads with all columns |

## 6. Insights

| ID | Steps | Expected |
|---|---|---|
| I1 | Open **Insights** | Bookings count, cancellations %, no-shows %, needs-review, booked value, payments recorded — all reflect real data |

## 7. Google Calendar sync

| ID | Steps | Expected |
|---|---|---|
| G1 | Settings → Google Calendar → **Connect Google Calendar** → Connect calendar → sign in (test user) → Allow | Returns to BookNest; Availability shows **Connected** |
| G2 | Create/confirm a booking for that Availability | Appointment appears on the connected Google Calendar at the right time |
| G3 | Reschedule the booking | Google Calendar event moves to the new time |
| G4 | Cancel the booking | Google Calendar event is removed |

## 8. Lifecycle

| ID | Steps | Expected |
|---|---|---|
| L1 | **Check in** a confirmed booking → Undo check-in | Status toggles; calendar/dashboard update |
| L2 | **Complete** / **No-show** | Status set; reflected in Insights |
| L3 | **Reschedule** (merchant) | New time saved; email sent; old slot freed |
| L4 | **Cancel** (merchant) | Status Cancelled; email sent; slot freed; Google event removed |
| L5 | Customer **reschedule/cancel** via portal link | Honored within cutoff rules |
| L6 | **Order cancelled / refunded** in Shopify | Matching booking auto-cancelled (orders/cancelled, refunds/create) |

## 9. Edge cases & safety

| ID | Steps | Expected |
|---|---|---|
| E1 | Two shoppers book the **same slot** simultaneously (two browsers) | Only one succeeds; the other sees "slot no longer available" (no double-booking) |
| E2 | Pay for a slot that got taken during checkout | Booking lands as **Needs review**, not silently double-booked |
| E3 | Deposit service (Fixed / Percentage) | Correct deposit charged at checkout; balance noted |
| E4 | Intake questions on a service | Questions shown in the widget; answers saved on the booking |
| E5 | Minimum notice / booking window / cancellation cutoff | Slots and actions respect the configured limits |

## 10. Compliance & cross-platform

| ID | Steps | Expected |
|---|---|---|
| P1 | `https://app.booknestapp.site/privacy` and `/terms` | Load publicly (200) |
| P2 | Uninstall the app | `app/uninstalled` processed; store data handling triggered |
| P3 | GDPR webhooks (customers/data_request, customers/redact, shop/redact) | Processed automatically |
| P4 | Resize admin pages at 480 / 768 / 1024 / 1280 | Layout stays usable (mobile-first) |
| P5 | Navigate between pages (Bookings, Events/Services, Settings, etc.) | Client-side nav, no blank pages |

## Known caveats (state these in reviewer notes)

- **Google Calendar** is in Google **Testing** mode: only added test users can connect until Google
  completes OAuth verification for the sensitive `calendar.events` scope. For review, either add the
  reviewer's Google account as a test user, or note that Calendar sync is an optional integration
  pending Google verification. Core booking does not require it.
- **Billing**: if the app is paid, Shopify Billing must be wired up before submission; if free, the
  listing declares Free. (Decide before submitting.)
- **Race tests**: the advisory-lock + unique-constraint protection is implemented; the two
  Postgres-specific race tests require `BOOKNEST_TEST_DATABASE_URL` and are skipped in CI, but the
  capacity behavior is verified via the end-to-end flow (E1/E2).

## Sign-off

| Area | Tester | Date | Result |
|---|---|---|---|
| Install & setup (S) | | | |
| Catalog (C) | | | |
| Storefront & booking (W/O) | | | |
| Dashboard & insights (D/I) | | | |
| Google Calendar (G) | | | |
| Lifecycle (L) | | | |
| Edge cases (E) | | | |
| Compliance (P) | | | |
