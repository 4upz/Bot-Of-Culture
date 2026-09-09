# Cosigned capacity hardening implementation plan

> Execute with subagent-driven-development. The user approved the existing assessment and fixes; no renewed design approval is required.

**Goal:** Make the one-VM viewer deployment bounded and reviewable, and measure an isolated representative workload before public launch.

**Design:** Approved assessment in `/private/tmp/cosigned-capacity-assessment.md`. Keep one Node process and remote MongoDB. Preserve privacy filtering, mutation revisions and authoritative member snapshots. No public DNS/firewall changes, production writes, VM restart, host resizing, or purchases in this task.

## Task 1 — HTTP boundary

Modify `src/web/server.ts` and targeted tests. Use explicitly configured exact proxy IPs only (no global trust or trusting client headers directly). Test that two forwarded clients have independent limits and spoofed leftmost addresses do not bypass limits. Bound admission and buckets. Disconnects signal cancellation, but slots remain occupied until database work actually settles. Add a whole-read deadline interface to service without Promise.race releasing work early. Test failed, cancelled and overloaded requests and resource cleanup. Keep existing API and no-store behavior.

## Task 2 — Database work

Modify `src/web/service.ts`, optionally `query.ts`, and service/Mongo tests. Per-request cancellation/deadline context must check before every query, and remaining deadline bounds maxTimeMS. Reduce serial per-title preview calls using a bounded batched aggregation, with bounded arrays (no unbounded push), preserving exact averages, keyset ordering, privacy and source redaction. Batch source eligibility checks where safe. Recheck privacy/generation at end. Test 10-title pages, search, pagination, copied attribution, cancellation and query bounds with real Mongo.

## Task 3 — Deployment durability

Modify `startup-script.sh`, `cloudbuild.yaml`, add focused deployment script/config tests and operational docs. Remove blanket Docker pruning. Keep current and prior working images, use explicit scoped cleanup only if necessary, fail before stopping healthy bot when space/pull/config validation fails. Bound logs; preserve Caddy data. Persist runtime/proxy configuration under `/var/lib`, restore ephemeral COS prerequisites idempotently; keep public-ingress activation behind explicit readiness. Avoid whole-VM reset for normal deployment; stage/validate startup script and invoke controlled container rollout with health/rollback verification. No live deployment execution. Validate with shell syntax and mocked command tests.

## Task 4 — Isolated workload measurement

Create repeatable synthetic-only harness under `scripts/review-web/` and documentation. Start disposable Mongo replica set with explicit local-only test database naming; generate realistic review distribution and indexes at about 600 and 6000 reviews. Run actual service/HTTP/viewer API flows with 1,5,10 readers, pagination/search/refresh and short overload; stub Discord/provider clients, exercise a lightweight bot-event heartbeat in same process. Use Docker CPU 0.25 and bounded RAM for app, simulated DB round-trip latency, measure RSS/event-loop/response p95/errors/query calls. Report limits of emulation. No production load or credentials. Cleanup only named test containers/volumes.

## Verification / completion

Run targeted regressions first, full functional suite with isolated Mongo, TypeScript build, deployment dry tests, and constrained load scenarios. Independently review final diff. Fix actionable findings; record real results and limitations in repository docs. Commit and push current authorized branch/PR only; do not merge or deploy. Report remaining Server Members Intent, fresh backup/exception-aware migration rehearsal, disk provisioning if necessary, and public firewall/DNS permission gates.

## Execution record

- Tasks 1–3 implemented and independently reviewed. HTTP 9 regression tests, service 2 unit tests, real Mongo 2 tests (plus service tests), deployment 7 mocked tests and TypeScript checks pass in targeted runs.
- Review fixes: canonical IPv6 proxy matching; full log consumption under pipefail; timeout samples and separate overload/recovery metrics in harness.
- Task 4 completed nine final scenarios at 0.25 CPU / 384 MiB: 600/400, 6000/400 and 6000/4000 reviews/titles, each with 1/5/10 readers. All dense normal phases passed; wide 10-reader normal phase had one 429, and wide overload phases hit bounded database timeouts then recovered. Full measured evidence and limits are in `docs/validation/cosigned-capacity-2026-09-09/README.md`.
- Final TypeScript build, 67/67 Node tests with real isolated Mongo (zero skips), shell syntax and 7/7 mocked deployment checks passed. Independent final review found no remaining actionable issues. No unrestricted wide-growth capacity claim is made.
- Production remains untouched throughout fixes/tests. Public/DNS/firewall, migration and intent gates unchanged.

- Named local capacity containers and their synthetic Mongo volume were removed after verification. Final report independently checked against every adjacent JSON result.
