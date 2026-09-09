# Approved review web implementation

Base: remote master 3781f95; existing checkout branch codex/review-web. No production operations authorized.

1. Global schema and public query/privacy/membership API (root).
2. Safe Discord writers and visibility/link commands (discord agent).
3. Read-only responsive viewer and safe Discord Markdown (viewer agent).
4. Dry-run archive migration, verification/rollback and title backfill (migration agent).
5. Integrate runtime, test all contracts, inspect UI, document operational gates.

See ../specs/2026-09-08-review-web-scope.md and ../../design/review-web-early-mockup.svg for approved acceptance criteria. Raw review Markdown is preserved; safe Discord-style rendering supersedes plain-text initial rendering in the scope.

## Implementation decisions and verification

- Schema uses `ReviewPreference.isPublic` (boolean) instead of the proposed enum;
  missing rows are public and malformed explicit values fail closed. Canonical
  origin is `originGuildId`, with the old `guildId` preserved for recovery.
- Local database tests use a disposable MongoDB 7 replica set, never application
  secrets. Actual Prisma aggregations, namespace separation, literal search,
  privacy redaction, snapshot paging, concurrent create and HTTP headers are covered.
- Reviews and title pages are bounded in MongoDB; titles aggregate all eligible
  scores before loading three-review previews. There are no request-time provider
  calls. Membership is complete-snapshot plus events, with stale/disconnect guards.
- Cursor tokens use a process-random HMAC key, preference-state hash, mutation
  revision and membership generation. Empty-search cursors survive metadata updates;
  search cursors invalidate when title coverage changes. Single-process writes and
  paused writers during maintenance remain required.
- Independent review found and resolved in-flight identity lookup timing, co-sign
  excerpt suppression, aborted-request concurrency accounting, startup readiness,
  blocked migration report visibility and static-error diagnostics.
- The installed CodeRabbit CLI is 0.3.5, below the skill's 0.4.0 minimum for agent
  review. Independent local code review was used; no code was sent to that service.

Final verification (2026-09-09): Prisma client generation and TypeScript build
pass. Complete source-based suite passes **53 tests, zero skipped**, including
the two replica-set migration/backfill tests and Prisma/API integration test.
Shell/CLI syntax and `git diff --check` pass. Corrected desktop and 360px mobile
library/profile were inspected in the in-app browser using fictional fixtures;
mobile DOM width and scroll width both measured 360px. The local test database
container was removed afterward. Live Discord command registration, privileged
intent activation, production provider coverage, backup rehearsal, HTTPS setup,
production migration and deployment were deliberately not performed.
