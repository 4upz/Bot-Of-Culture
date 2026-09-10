# Cosigned production release — September 10, 2026

Production is live at https://cosignedapp.com. The homepage redirects to the Men of Culture library at `/g/510987493340872704`. Public HTTPS returned 200 with a valid certificate; HTTP redirects to HTTPS. The browser loaded the library and expanded a title through its remaining reviews. The bot completed controlled startup with zero restarts and no OOM event.

## Artifacts and verification

- Deployed source: `1562476c190a28ac6a4bcad084839da48ccbbb00` (PR #10; subsequent release-record edits are documentation only).
- Accepted image: `gcr.io/bot-of-culture/bot-of-culture@sha256:a82680be474759f7ebe50e0ee9aa0ba07bb4db63a3c54f8af5a9f61df083d65d`.
- Build `c7ad4ba0-129f-4d06-bd57-253cbc23b9c5` and packaged module/asset smoke build `0b05f7ba-b8c6-424f-8d1b-237fed8edc07` succeeded.
- Schema-compatible recovery from merged master `02a033d`: `gcr.io/bot-of-culture/bot-of-culture@sha256:4bf68f57195ede008dc571307c7cac932e9e80814e43b877696f6bc231a3b78e`. Build and packaged smoke passed; it was pulled and validated before rollout.
- TypeScript build passed. All 74 Node tests passed with zero skips using isolated Mongo; all eight mocked rollout checks and shell syntax passed. Independent migration review had no remaining findings.
- Two isolated backup rehearsals exercised preservation, apply/verify/repeat and rollback/repeat. The final implementation restored all 597 BSON originals exactly, including unknown fields and numeric types.

## Approved infrastructure changes

The user explicitly approved Server Members Intent, the 10 to 20 GiB balanced disk increase (approximately $1/month), public TCP 80/443 only on the bot VM, and the domain DNS change. All were completed.

The existing `bot-of-culture` VM in `us-central1-c` remains the host. The disk and live COS stateful filesystem expanded without reboot; roughly 9 GiB remained after both images were pulled. Firewall `cosigned-web` targets only this VM. DNS points directly to reserved IP `34.27.239.219`. No broad image or volume cleanup occurred. Discord Presence and Message Content intents remain unchanged.

Caddy uses persistent certificate/config volumes, host networking, a 128 MiB limit and bounded logs. Its production config redirects `/` to the production library and proxies to `127.0.0.1:8080`. The bot port is loopback-only. Bot limits are 384 MiB, no swap and 0.75 CPU, with bounded logs and `unless-stopped` restart policy. Post-rollout observation was approximately 56 MiB bot memory and 21 MiB Caddy memory.

Durable `/var/lib/bot-of-culture/runtime.env` is root-owned, mode 0600, with migration readiness and web serving enabled, the HTTPS origin, and explicit trusted bridge gateway `172.17.0.1`. Startup metadata and the durable script match repository SHA-256 `ea2abe78d21625f2f2616d4f6bf5bd80ef37d27548d92060203642e282aad0a6`.

## Production data preservation

The old bot stopped with restart disabled before backup, audit or mutation. The fresh maintenance backup was copied off-VM and its checksum verified before apply. The audit matched all 597 fresh source checksums and the three approved production winners.

- Migration batch: `6aa2e7baeda730a7835b491f`.
- Before: 265 movie, 170 series, 156 game and 6 music reviews (597 total).
- After: 587 canonical reviews, with 10 duplicate rows removed from active collections. All 597 originals remain archived, including canonical before-images. No originals were discarded.
- Apply and baseline verify completed with writers paused. Global user/media unique indexes and supporting indexes were added afterward; no index dropping or `prisma db push` was used.
- Metadata backfill wrote 413 of 414 titles. TMDB movie `929614` is unavailable; its review is preserved with the existing “Title unavailable” fallback. All three server libraries currently have complete title coverage because this review is outside their eligible member sets.

Private release files are on the VM under `/var/lib/bot-of-culture/release-2026-09-10/` and off-VM under `/Users/ariksmith/Backups/Bot-Of-Culture/2026-09-10-cutover/`. Keep them outside Git:

| Off-VM file | SHA-256 |
| --- | --- |
| `maintenance-bson.json` | `e5cf8892694378babc91efba3ca4b6988a543faed273d9f39d760907e8ced657` |
| `production-audit-planned.json` | `ac54afb0c2a73214575d8d432ff02e404be34e851514de4f4d145d85a906ed91` |
| `production-audit-verified.json` | `933f28937f4d0bddee3f7b8fef7267f3012d0466ca2e9bd7d506a62e9d268296` |

`winner-overrides.json` binds each approved winner to all source checksums in its group. The September 9 backup remains unchanged. `live-api-verification.json` contains count-only results. Previous Discord command definitions are also retained privately on the VM.

## Live behavior

The operator made 43 successful production API reads and compared all server pages against independent native Mongo reads and current Discord member lists:

| Server | Members | Visible titles | Eligible reviews | Pages checked |
| --- | ---: | ---: | ---: | ---: |
| Men of Culture | 61 | 371 | 514 | 19 |
| Ghosthouse | 14 | 183 | 190 | 10 |
| Bot Test Server | 9 | 209 | 234 | 11 |

Counts overlap intentionally: global reviews can appear in multiple current-member libraries. Profile reads, title search and expanded review pagination passed. Responses used `Cache-Control: no-store`; unknown profiles, unavailable guilds and malformed filters failed closed. Serialized reviews and copied-source attribution matched eligible database records and current membership. There were no private or opted-out production records at verification time; exclusion behavior is covered by real-Mongo integration tests without changing real users' preferences during deployment.

The global `/reviews` command is registered with `profile`, `server` and `visibility` subcommands. The seven other global commands were verified unchanged, and no guild-level `/reviews` override shadows it in the three installed servers. No messages were sent to users or channels during verification.

## Recovery and limits

Accepted and compatible recovery digests are recorded in `/var/lib/bot-of-culture/accepted-image` and `compatible-rollback-image`. The legacy container and all images remain retained, but its restart policy is disabled. **Never restart the legacy writer against the migrated schema.** Use the compatible recovery image through the controlled rollout script.

A database rollback requires separate maintenance: pause writers, preserve post-cutover writes and preferences, reconcile conflicts, and handle incompatible indexes as described in the operations guide. The archived baseline must not overwrite later user edits. Baseline migration verification is intended for paused writers; legitimate later writes will deliberately fail its checksum comparisons.

Boot restoration uses durable configuration and approved firewall flags; it does not pull or replace bot images. No live VM reboot was performed. The small VM remains the initial host. Earlier controlled capacity tests support normal small-server traffic; query/rate limits remain enabled, and this release does not claim sustained high-concurrency capacity.
