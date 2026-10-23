# BookNest — Data Loss Prevention Strategy

_Last updated: 23 October 2026_

> Operational policy supporting BookNest's Shopify Protected Customer Data (Level 2) attestation.
> Review each statement against the live configuration before relying on it; items marked
> **(verify)** depend on the current hosting setup and must be confirmed true before attesting.

## 1. Data inventory

BookNest stores only what the booking functionality needs:

- Merchant-customer **name** and **email** (phone only if a customer provides it on a free booking).
- Booking details: service, date/time, quantity, price, order and reservation identifiers.
- Merchant store domain and Shopify offline access token; Google Calendar token if connected.

No billing or shipping addresses, card data, or government identifiers are stored.

## 2. Minimization and separation

- Only the fields above are collected; nothing is retained "just in case."
- Every database query is scoped by `shopId`, so one merchant's data is never exposed to another.
- **Test and production data are kept separate** — development runs against a Shopify development
  store and a separate database from production.

## 3. Access control

- Access to production (hosting console, database, Shopify Partner account, source repository,
  email provider) is limited to the single responsible operator.
- Strong, unique passwords are required for every operator account, with multi-factor
  authentication enabled where the provider supports it (Shopify, source host, email, hosting).
- Administrative access to records containing personal data is logged.

## 4. Encryption

- **In transit:** all traffic to BookNest and between BookNest and its subprocessors uses HTTPS/TLS.
- **Secrets:** Shopify and Google access tokens are encrypted at the application layer before storage.
- **At rest:** the production database volume is encrypted at rest **(verify — confirm the hosting
  volume / database uses disk encryption; enable it if not)**.

## 5. Backups

- The production database is backed up on a regular schedule.
- Backups are **encrypted** and stored separately from the primary database **(verify — confirm the
  backup target uses encryption)**.
- Restores are tested periodically so a known-good backup can be recovered after data loss.

## 6. Monitoring and logging

- Application errors and access to personal-data endpoints are logged server-side and retained on
  the host; hosting and database alerts are monitored by the operator.

## 7. Retention and deletion

- Customer name, email, and phone are anonymized **24 months** after the appointment date.
- Shopify's mandatory compliance webhooks are implemented and processed automatically:
  `customers/data_request`, `customers/redact`, and `shop/redact` — so data-subject and shop
  deletions are honored without manual steps.

## 8. Subprocessors

Resend (transactional email), Google (only if Calendar is connected), Anthropic (only if AI insight
summaries are enabled; receives aggregate counts only, never individual customer records), and the
hosting provider. Each is used strictly to operate BookNest.

## 9. Review cadence

This strategy is reviewed at least annually and whenever hosting, subprocessors, or data flows change.
