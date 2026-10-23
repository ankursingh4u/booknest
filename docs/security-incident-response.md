# BookNest — Security Incident Response Policy

_Last updated: 23 October 2026_

> Operational policy supporting BookNest's Shopify Protected Customer Data (Level 2) attestation.
> Review each statement against the live configuration before relying on it; update when the
> hosting, tooling, or responsible operator changes.

## 1. Purpose and scope

This policy defines how BookNest detects, responds to, and reports security incidents that
affect personal data processed on behalf of merchants — primarily merchant-customer **name and
email**, booking details, and the Shopify/Google access tokens BookNest stores. It applies to the
BookNest application, its database, its hosting environment, and any subprocessor involved in
delivering the service.

## 2. Responsible operator

BookNest is operated by a single responsible operator who owns incident response. Contact:
**admin@swiftcart.live**. The operator maintains access to the hosting console (Coolify), the
database, the Shopify Partner account, the source repository, and the email provider.

## 3. What counts as an incident

- Unauthorized access to, or disclosure of, customer personal data or access tokens.
- Loss, corruption, or ransom of the production database or backups.
- Compromise of an operator credential (hosting, database, Partner account, repository, email).
- A vulnerability in BookNest or a dependency that is being, or could be, exploited against
  customer data.
- A subprocessor (Shopify, Resend, Google, Anthropic, hosting provider) reporting a breach that
  affects BookNest data.

## 4. Detection

- Application errors are logged server-side; request/access logs are retained on the host.
- Hosting-provider and database alerts (resource, availability, auth failures) are monitored.
- Shopify Partner and subprocessor security notifications are monitored at the operator email.
- Dependency advisories are reviewed when raised by the repository/package tooling.

## 5. Response procedure

1. **Triage & classify** — confirm the report, record the time first observed, and assign a
   severity: _High_ (confirmed exposure of personal data or token), _Medium_ (credible risk, no
   confirmed exposure), _Low_ (no personal data at risk).
2. **Contain** — revoke or rotate affected credentials and Shopify/Google tokens, block the
   access path, and, if needed, take the affected component offline.
3. **Assess** — determine what data was affected, which merchants and customers are impacted, the
   root cause, and whether data was exfiltrated or altered.
4. **Remediate** — patch the root cause, restore from a known-good encrypted backup if data was
   lost or corrupted, and verify integrity before returning to service.
5. **Notify** (see §6).
6. **Review** (see §7).

## 6. Notification

- Affected **merchants** are notified without undue delay and within **72 hours** of confirming an
  incident that affects their customers' personal data, including what happened, what data was
  involved, and the steps taken.
- **Shopify** is notified where required by the Partner Program Agreement / API Terms.
- Where the operator or an affected merchant has a legal obligation to notify a data protection
  authority or data subjects, that is supported with the incident details gathered above.

## 7. Post-incident review

After resolution, the operator records a short write-up: timeline, root cause, impact, remediation,
and preventive actions. Preventive actions are tracked to completion.

## 8. Review cadence

This policy is reviewed at least annually and whenever the hosting, subprocessors, or responsible
operator change.
