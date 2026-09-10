# Cosigned production cutover plan

The user requested completing the previously documented deployment gates. Preserve all review originals and the three approved production winners. Keep the existing one-VM architecture and domain. Use subagent-driven development for the bounded migration change alongside independent release preparation.

- [x] Implement explicit checksum-bound per-review winner overrides, fail closed on stale/unmatched choices, and test lossless archive/apply/rollback on synthetic fixtures.
- [x] Derive the three approved production winners from the restricted backup; rehearse the exact exceptions on an isolated restored database, compare every BSON original after rollback.
- [x] Verify merged release image and prepare a schema-compatible recovery image; stage durable configuration/startup and validate without stopping the bot.
- [x] Check Server Members Intent through the supported Discord settings interface and enable it within the requested deployment scope.
- [x] Prepare exact disk resize and public firewall/DNS actions; obtain direct approval for the outstanding cost/exposure gates before executing them.
- [x] With prerequisites ready, pause writers, create fresh restricted backup and audit, apply reviewed exceptions, verify archive and canonical counts, install compatible indexes and backfill titles.
- [x] Roll out immutable candidate with tested compatible recovery, verify guild/profile/privacy and bot health, enable HTTPS and verify the public domain.
- [x] Record deployed digests, backup/audit locations and operational limits. Report any remaining blocker precisely; do not claim production until verified.

No blanket Docker cleanup, loss of original review data, unrelated domain changes or legacy-writer restart after migration. Existing backup contains private data and stays outside the repository. Full production cutover includes expected bot downtime, only after prerequisites are met.

Execution complete: the user approved all remaining settings, cost and public exposure actions. The migration applied and verified against a fresh maintenance backup. Production rollout, command registration, 43 live API reads and public HTTPS/browser checks passed. See the September 10 release record for artifacts and recovery details. Metadata is available for 413 of 414 provider IDs; the unavailable historical movie review remains intact.
