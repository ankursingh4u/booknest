# BookNest — Security Incident Response Policy

Owner: admin@swiftcart.live
Last updated: 15 October 2026

This policy applies to any incident involving unauthorized access to, loss of,
or exposure of merchant data or customer personal data (name, email, phone)
processed by BookNest.

## 1. Detection

Incidents may surface through:
- Sentry error alerts (when `SENTRY_DSN` is configured)
- Coolify deployment/health-check alerts
- A merchant, customer, or Shopify report
- Routine review of `AccessLog` entries for access patterns that don't match
  normal admin/Team Portal usage

## 2. Triage (within 24 hours of detection)

1. Confirm whether the report is a real incident.
2. Identify what data and which shop(s) are affected.
3. Classify severity:
   - **Critical** — customer personal data exposed or at risk of exposure
   - **High** — merchant credentials or Shopify access tokens at risk
   - **Low** — no personal data involved (e.g. a non-sensitive bug)

## 3. Containment (immediately upon confirming Critical or High severity)

- Rotate the affected credential(s): `SESSION_SECRET`, `SHOPIFY_API_SECRET`,
  database password, or Google/Resend/Anthropic keys, as applicable.
- If a specific shop's data is compromised, revoke its Shopify session
  (`session.deleteMany`) and, if necessary, disable the app for that shop.
- If the vulnerability is in deployed code, ship a fix and redeploy before
  any other remediation step.

## 4. Notification

- **Affected merchants**: notified by email within 72 hours of confirming
  the incident, describing what happened, what data was involved, and what
  was done.
- **Shopify**: notified per the Partner Program Agreement's incident
  disclosure requirements.
- **Data protection authorities**: if personal data of EU/UK individuals was
  exposed, this may trigger a GDPR Article 33 obligation to notify the
  relevant supervisory authority within 72 hours of becoming aware.

## 5. Remediation and review

- Document root cause, timeline, and fix in a short postmortem.
- Add a regression test covering the specific failure where practical.
- Review whether the retention policy (`CUSTOMER_DATA_RETENTION_MONTHS` in
  `app/db.server.ts`) or access logging (`app/lib/audit/access-log.server.ts`)
  would have reduced the impact, and adjust if so.

## Contact

Report suspected incidents to **admin@swiftcart.live**.
