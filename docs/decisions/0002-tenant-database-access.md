# ADR 0002 — Tenant database access

Status: accepted, updated 2026-10-14.

## Decision

Application routes use getShopDatabase(shopId), with identity established by a
verified Shopify session. Storefront requests use verified Shopify App Proxy
identity. Customer booking tokens authorize one booking; signed team sessions
resolve a current active seat and its assigned Availability. Request shopId and
staffId parameters never establish tenant or team identity.

A Prisma query extension intersects caller filters with ownership, preserves
unique selectors, injects shopId on writes, rejects reassignment, and checks
foreign-key ownership. Indirect models use their ownership relations. Unknown
models and operations fail closed.

withShopTransaction exposes a guarded transaction proxy, with reference checks
against the same transaction. This permits ServiceStaff and IntakeAnswer writes
that reference newly created records. Nested writes, arbitrary raw SQL, and
global JobLog creation remain unavailable. Background delivery uses tenant-owned
NotificationTask and SeatUsage outboxes.

The raw singleton stays private. Narrow repositories own verified OAuth/session
infrastructure, capability resolution, privacy deletion, and worker enumeration.
Worker enumeration returns only IDs/domain metadata needed to establish the
tenant client. Parameterized advisory locks live in this private repository.

## Consequences

The wrapper does not retrofit composite tenant foreign keys into the initial
schema. Existing or manually inserted records must preserve tenant consistency.
Nested reads rely on that invariant. Domain operations still need explicit
transactions and locks for scheduling/payment invariants.

The complete local suite currently has 178 passing tests, including tenant
filters, reassignment, nested/raw rejection, reference ownership, transactional
creation, query dispatch, sessions, and limited team access. Two database race
tests are skipped pending an isolated PostgreSQL database. Migrations have not
been applied live; production build and embedded UI verification remain pending.
