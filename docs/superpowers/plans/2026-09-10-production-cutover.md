# Cosigned production cutover plan

The user requested completing the previously documented deployment gates. Preserve all review originals and the three approved production winners. Keep the existing one-VM architecture and domain. Use subagent-driven development for the bounded migration change alongside independent release preparation.

- [ ] Implement explicit checksum-bound per-review winner overrides, fail closed on stale/unmatched choices, and test lossless archive/apply/rollback on synthetic fixtures.
- [ ] Derive the three approved production winners from the restricted backup; rehearse the exact exceptions on an isolated restored database, compare every BSON original after rollback.
- [ ] Verify merged release image and prepare a schema-compatible recovery image; stage durable configuration/startup and validate without stopping the bot.
- [ ] Check Server Members Intent through the supported Discord settings interface and enable it within the requested deployment scope.
- [ ] Prepare exact disk resize and public firewall/DNS actions; obtain direct approval for the outstanding cost/exposure gates before executing them.
- [ ] With prerequisites ready, pause writers, create fresh restricted backup and audit, apply reviewed exceptions, verify archive and canonical counts, install compatible indexes and backfill titles.
- [ ] Roll out immutable candidate with tested compatible recovery, verify guild/profile/privacy and bot health, enable HTTPS and verify the public domain.
- [ ] Record deployed digests, backup/audit locations and operational limits. Report any remaining blocker precisely; do not claim production until verified.

No blanket Docker cleanup, loss of original review data, unrelated domain changes or legacy-writer restart after migration. Existing backup contains private data and stays outside the repository. Full production cutover includes expected bot downtime, only after prerequisites are met.

Execution: migration overrides implemented with independent review; stale missing-source resume case corrected. Exact-backup final rehearsal passed all597 originals through archive/apply/verify/repeat/rollback. Merged image build and no-network smoke passed. Runtime/startup/Caddy drafts staged but inactive. Discord sign-in, disk cost and public exposure approvals remain outstanding. Full regression rerun follows correction of a stale search query-count assertion in merged master.
