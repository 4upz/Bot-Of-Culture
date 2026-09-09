# Cosigned single-VM capacity validation — 2026-09-09

The fixes support an initial controlled launch on the existing VM at the current
roughly 600-review scale. They do **not** establish unrestricted 10x growth
capacity. Dense growth to 6,000 reviews passed; growth to 4,000 distinct titles
exposed database contention and throttling. A second application host is not
justified by these results alone: the application stayed small and responsive,
while expensive database reads became the constraint.

## Setup and scope

Actual compiled Express viewer, Prisma 6.18.0 and Discord BotClient class on
Node 18.20.8, Linux ARM64 in Docker Desktop. No Discord login, external provider
calls, production secrets, production requests or writes. Authoritative guild
membership was stubbed with 84 synthetic members. A timer every 50 ms and a
simple real Prisma read every two seconds measured responsiveness in the same
process and connection pool; these are proxies for bot work, not full commands.

The app plus fixture proxy used a 0.25 CPU quota, 384 MiB memory limit with no
swap and a 192 MiB Node heap ceiling. Separate synthetic MongoDB 7 had one CPU,
512 MiB memory and a 256 MiB WiredTiger cache. Each aggregate and bot read added
40 ms simulated latency. Database indexes matched the planned post-migration
user/media uniqueness, user/date, media/date, title identity and preferences.

Each normal run lasted 45 seconds. Readers opened 500 ms apart, then paged,
searched, viewed profiles/expanded reviews and refreshed after 30 seconds, with
four-second pauses between actions. Each run ended with a separate simultaneous
20-request burst and a recovery request. Dense fixtures exercise expansion;
wide fixtures have too few reviews per title to need expansion. All phases
include transport failures in their counts. RSS is sampled process memory,
including the fixture proxy, and may retain a warmed high-water footprint.

## Changes and evidence

- Trust only configured, canonical immediate proxy IPs. Forwarded-header spoofing
  cannot create arbitrary client identities. Rate buckets and active reads are bounded.
- Keep active admission occupied until actual work settles. An eight-second
  cooperative read deadline prevents subsequent queries, while each database
  aggregate has at most five seconds or the remaining deadline. Driver/network
  hangs can retain a slot beyond that deadline; this is not a hard socket timeout.
- Group eligible reviews before title joins; push preview/source keys into the
  initial collection match; batch previews and copied attribution. A normal
  ten-title guild page now takes five aggregate calls, search eight. Privacy,
  complete coverage, ordering, cursor invalidation and source redaction remain tested.
- Build/publish only in Cloud Build. Controlled rollout retains images, checks
  free disk before stopping the current bot, bounds logs/resources, requires
  compatible rollback and restores persistent COS configuration. No rollout ran.

An earlier batched implementation failed the dense 6,000-review/10-reader case
(55 successful requests, five throttles and 15 temporary failures; p95 7.29 s).
Predicate pushdown alone still had 11 temporary failures. The final grouping
change eliminated normal errors for that fixture. Earlier results are retained
as diagnostic evidence, not mixed into final measurements.

## Final measured results

| Reviews / shape | Readers | Requests | HTTP statuses | Viewer p95 ms | Peak RSS MiB | Bot read p95 ms |
| --- | ---: | ---: | --- | ---: | ---: | ---: |
| 600 | 1 | 11 | {'200': 11} | 446 | 119 | 51 |
| 600 | 5 | 54 | {'200': 54} | 440 | 112 | 51 |
| 600 | 10 | 104 | {'200': 104} | 443 | 125 | 51 |
| 6000 | 1 | 11 | {'200': 11} | 500 | 139 | 52 |
| 6000 | 5 | 53 | {'200': 53} | 504 | 119 | 51 |
| 6000 | 10 | 101 | {'200': 101} | 790 | 124 | 52 |
| 6000 wide | 1 | 11 | {'200': 11} | 628 | 121 | 53 |
| 6000 wide | 5 | 52 | {'200': 52} | 584 | 116 | 50 |
| 6000 wide | 10 | 93 | {'200': 92, '429': 1} | 3262 | 129 | 73 |

All nine normal phases had zero bot-read errors or skipped probes. For the
wide 10-reader case, event-loop delay p95 was 15.8 ms (maximum 389 ms), bot timer
excess delay p95 4.5 ms (maximum 354 ms), and bot read maximum 279 ms. Short
maximum stalls are therefore possible even when the percentile remains low.

Every 400-title overload phase completed eight admitted reads and rejected 12
with HTTP 429. Every 4,000-title overload phase rejected 12 and returned HTTP 503
for eight admitted reads after database time limits; the following single request
succeeded in 430–563 ms. This is bounded failure and recovery, **not** a passing
wide-growth overload test. The wide 10-reader normal phase also throttled one
refresh. Lower reader counts passed their normal phases.

The adjacent `load-*.json` files contain complete final metrics. Files prefixed
`diagnostic-` preserve earlier failing implementations and are not final results.
`explain-*.json` summarize indexes and initial collection work from actual service
pipelines; cursor times/documents are not totals for every nested union/lookup.

## Regression verification

Final TypeScript build passed. The full Node suite passed **67/67**, with zero
skips, using the isolated Mongo replica set for migration and viewer integration
tests. Shell syntax passed and all **7 mocked rollout tests** passed. Independent
review covered HTTP/query/deployment fixes and the load fixture; findings about
IPv6 proxy normalization, shell log handling and measurement accounting were
fixed before these final runs. CodeRabbit CLI was below the skill's required
version, so no remote CodeRabbit review is claimed.

## Interpretation and release gates

These short API tests are not a browser/TLS test or a soak. ARM64 Docker CPU
quotas do not reproduce x86 GCE shared-core scheduling, and local Mongo plus
added latency does not establish production Atlas capacity. Application RSS
excludes Mongo and host/Caddy memory. Real Discord command/provider activity,
production membership refreshes and production database latency still need a
small monitored launch. Watch memory, viewer p95/429/503 rates, database query
latency and bot responsiveness. Reassess queries/database capacity before the
wide-growth workload; merely adding a viewer host may increase database pressure.

Deployment remains gated on Server Members Intent; fresh maintenance-window
backup and an exception-aware migration rehearsal; verified migration/indexes
and a tested schema-compatible rollback image; actual eligible-guild/privacy
readiness; explicit public firewall/DNS approval; and sufficient disk space.
The approved Barbarian, Black Panther: Wakanda Forever and Game Dev Story
production-winner exceptions still require implementation/rehearsal in migration
tooling. Existing lossless backup and user decisions remain preserved.

The observed 10 GiB boot disk had only 825 MB free, below the rollout's 4 GiB
pre-pull floor. A 20 GiB pd-balanced disk is a concrete option adding about
US$1/month at the Iowa list rate, before taxes/snapshots; actual image unpack
headroom must still be checked. No resize or purchase was made. See
[deployment procedure and pricing source](../../deployment-durability.md).

Production bot, database, DNS and ingress were not changed during this phase.
The staged Caddy container remains stopped. Public ingress/DNS actions were
previously blocked by automatic approval review and still need explicit approval.
