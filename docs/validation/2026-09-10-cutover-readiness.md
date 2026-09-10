# Cutover preparation — September 10, 2026

The merged master release (`02a033d`) built successfully as
`gcr.io/bot-of-culture/bot-of-culture@sha256:4bf68f57195ede008dc571307c7cac932e9e80814e43b877696f6bc231a3b78e`.
Cloud Build `e595b71b-587f-49d0-9a2c-04136088981d` also passed a no-network
module/static-asset smoke check. This image contains global-aware writers and
is the schema-compatible recovery candidate for the migration-tooling follow-up;
production readiness still requires the controlled startup and guild/privacy checks.

The follow-up adds optional explicit winner overrides for the three previously
approved duplicate decisions. Every override names one canonical ID and binds to
all original group checksums. Unknown, duplicate, unmatched or stale decisions
fail closed. Every original remains archived; privacy is inherited from any
private source. A missing source is accepted during resume only when its
same-batch archive is already APPLIED in the source transaction.

Two isolated rehearsals used the unchanged September 9 protected backup. The
final rehearsal exercised the complete implementation including the missing-source
resume guard: 597 originals restored, 587 canonical reviews, 10 duplicates, all
three approved production winners selected, zero test-over-production winners,
597 archive checksums verified, and all 597 originals matched after rollback and
repeated rollback. The backup SHA-256 remained
`66557b5a856f7a391da1604f7d2df4b6925434e465dcab26841a4b119c5653af`.
Private manifests and exact decisions remain outside the repository. This older
backup is not a maintenance-consistent snapshot; a fresh paused-writer backup and
checksum-bound audit are still mandatory before production mutation.

The full suite exposed a stale test expectation in the merged code: search now
uses seven aggregates because expansion cursors reuse the initial preferences
snapshot. The assertion was updated from eight to seven; runtime behavior was
not changed by that correction.

Read-only production checks found the bot still running, all four review counts
unchanged (265 movies, 170 series, 156 games, 6 music), and database reads working
from its existing VM. Local-workstation Mongo TLS failed; production operations
must use a verified working path without weakening database network controls.
The VM has roughly 887 MiB disk free; increasing its 10 GiB balanced disk to
20 GiB remains a separate approximately $1/month approval. Server Members Intent
was still disabled. Caddy remains stopped and DNS/public ingress remains gated.

Startup script and non-secret runtime/Caddy drafts are staged under `/tmp` on the
VM without activation. The runtime draft deliberately has migration readiness
false. Startup script SHA-256 matches the repository. Existing Caddy configuration
uses host networking, a 128 MiB limit, three 10 MB log files and persistent named
certificate/config volumes. No production migration, restart, disk resize or
public exposure occurred in this preparation.

Final verification: TypeScript build passed, all 74 Node tests passed with zero
skips using isolated Mongo, shell syntax passed, and all eight mocked rollout
checks passed. Independent migration review has no remaining findings.
