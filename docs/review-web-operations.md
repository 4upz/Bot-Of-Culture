# Review migration and title operations

Production cutover completed on September 10, 2026 after explicit approval, a restored-backup rehearsal, and a fresh paused-writer backup. The verified migration preserved all 597 originals and selected 587 canonical reviews, including the three approved production winners. See [the release record](validation/2026-09-10-cutover-readiness.md) for deployed artifacts, verification, protected backup locations, and recovery constraints. For future migrations, repeat the rehearsal, audit, conflict approval, backup and execution gates. MongoDB transactions are required; there is deliberately no standalone-server fallback.

## Private migration report

Use a dedicated `MIGRATION_DATABASE_URL` environment variable and an explicit database name. The tooling never reads application `DATABASE_URL`, starts the bot, registers commands or fetches production secrets. Set the URI using your approved secret mechanism; do not put it in command history. Confirm the actual target and production/test database isolation independently. The manifest contains complete review text and BSON originals, including unknown fields. Store it alongside the restricted backup outside any public/static tree. Files are written with mode 0600; protect the parent directory and archive collection too. Never publish this report.

The default mode is read-only for MongoDB and writes a local manifest:

```sh
node scripts/review-web/migrate.js --database restored_fixture --manifest /private/tmp/reviews-audit.json --production-guild PRODUCTION_ID --test-guilds TEST_ID --legacy-public-confirmed --legacy-origin-confirmed
```

`--test-guilds none` is explicit when there are no test guilds. `--legacy-public-confirmed` asserts that missing historical privacy flags mean public; without it, those records block planning. `--legacy-origin-confirmed` is optional and asserts that legacy guild IDs are proven creation provenance. Supply it only after checking deployment history. Without it, existing origins are preserved and unknown origins stay unknown. guildId itself is retained. No creation or edit timestamps are invented; unknown legacy updatedAt remains absent/null.

The report is keyed by migrationBatchId and SHA-256 plan checksum. It includes baseline counts, full source checksums, deterministic canonical selection, every source's production/test/other classification, dates, score, comment and privacy. Newest `_createdAt` wins globally per user and provider ID in each collection; descending ObjectId resolves equal timestamps. An older edited record cannot win because of updatedAt. `testWinnerOverProduction` highlights test content winning over production without silently excluding it. Any explicit private duplicate makes the canonical private. Invalid scores, identity, creation dates or privacy values produce a private BLOCKED manifest containing the first failing record/reason in each affected collection and a nonzero exit status. Blocked plans cannot apply; resolve their errors and create a new audit. No valid partial collection plan is used to bypass a blocked collection.

Approved exceptions can select an older original only through `dryrun --winner-overrides /restricted/winner-overrides.json`. The private JSON file must be an array of exact objects shaped as follows (placeholder checksums must be replaced with the canonical source checksums from the audit):

```json
[
  {
    "collection": "MovieReview",
    "userId": "123456789012345678",
    "mediaId": "123",
    "canonicalReviewId": "000000000000000000000001",
    "expectedSources": [
      { "originalReviewId": "000000000000000000000001", "sourceChecksum": "<64 lowercase hex characters>" },
      { "originalReviewId": "000000000000000000000002", "sourceChecksum": "<64 lowercase hex characters>" }
    ]
  }
]
```

Each exception binds the collection/user/media identity, selected original ID, and the IDs plus full BSON checksums of **every** original in that duplicate group. Unknown fields/collections, malformed IDs/checksums, duplicate entries, singleton groups, unmatched choices, and added, missing or changed sources block planning. Every supplied exception must match exactly one planned group across all collections. All other groups retain newest-created/ObjectId selection; no blanket production preference exists. The manifest embeds the approved exception list inside its checksum, and each group records its selection reason, default winner, and approved-exception checksum. The selected original receives the canonical-beforeimage archive role even when it is older. Privacy OR and archival of every original remain unchanged.

Apply/verify/rollback use that same reviewed manifest, without another override flag. For an overridden group, apply also rejects additional IDs introduced since audit before modifying that group's sources. Existing per-document checksum checks reject edited sources; already deleted duplicates are accepted only when their same-batch archive entry is already `APPLIED`, read inside the same source transaction. A newly `ARCHIVED` entry cannot turn an independently deleted original into a resumable migration. Keep all writers paused, as required for every migration. Store the exception file beside the private audit with mode `0600`; never commit real source checksums or identities.

Inspect all conflicts and test-server winners before applying. A newly generated final audit should follow stopping/draining every review writer. Manifest files are never silently overwritten by another dry run.

## Apply, resume and verify

```sh
node scripts/review-web/migrate.js apply --database restored_fixture --manifest /private/tmp/reviews-audit.json --writers-paused
node scripts/review-web/migrate.js verify --database restored_fixture --manifest /private/tmp/reviews-audit.json
```

The flag is an operator assertion, not an automatic writer lock. Keep writers paused through verification and index creation. The script first upserts and reads back archive entries for **every duplicate and every canonical before-image**, including singleton reviews. Canonical Extended JSON preserves BSON types and unknown fields. It compares exact payloads and checksums, refuses oversized archive documents and never overwrites an existing same-batch archive with changed content. The archive unique key is `(migrationBatchId, sourceCollection, originalReviewId, recordKind)`; there is no TTL or automatic purge.

Each review group is then changed in a transaction with source checksum preconditions and majority write concern. Archives exist before source deletion. A concurrent update conflicts with the transaction or fails the source checksum check. Repeat the same apply command and manifest after interruption: actual source state determines whether to skip completed operations, independently of diagnostic archive states. Changed records block instead of being overwritten. The private manifest is the resume plan; keep it intact with the backup.

Verification checks archive integrity, retained post-migration checksums, absence of every displaced ID and exact per-collection canonical counts. Run it while writers remain paused: later writes deliberately fail this baseline verification and must be reconciled. Only then install the global unique indexes and deploy global-aware writers together. **Do not run `prisma db push` with global unique indexes before deduplication.** Stage additive changes separately. The script does not create/drop review indexes, touch preference records or enable the web server.

## Rollback rehearsal and recovery

```sh
node scripts/review-web/migrate.js rollback --database restored_fixture --manifest /private/tmp/reviews-audit.json --writers-paused
```

Before rollback, disable web serving, pause writers, export post-migration writes, preserve preferences, and remove incompatible global review unique indexes under controlled maintenance. Restore appropriate guild-era indexes after duplicate restoration and deploy matching writers before resuming. The script does not automatically drop indexes: an incompatible unique index makes the transaction fail safely. There is no snapshot overwrite.

Original documents are restored with their original `_id` and complete BSON payload. Identical existing originals are skipped. A canonical before-image is restored only if its current checksum matches the expected migration output, or the document is missing. Any differing current content blocks that group and must be exported/reconciled manually; no later edits are overwritten. Missing duplicates can be reinserted; an existing mismatched ID blocks restoration. New IDs outside the manifest and all preference records remain untouched. Earlier groups may have completed before a later group conflicts; rerun after reconciliation with the same manifest. Check restored baseline documents/counts on the disposable database and explicitly reconcile legitimate later records before declaring recovery complete. The baseline `verify` mode checks applied state, not rollback state.

## Title-only backfill

```sh
node scripts/review-web/backfill-titles.js --database restored_fixture
node scripts/review-web/backfill-titles.js apply --database restored_fixture
```

Default dry run only reports missing distinct `(type, mediaId)` titles; it makes no provider requests and writes nothing. Apply enumerates IDs from the four review collections and writes only missing `MediaTitle` rows using a unique type/mediaId key. Existing last-known titles are retained. Each request extracts only provider ID and title/name; absent artwork, credits, episode arrays or album artists cannot break title extraction. It stores title, NFKC/lowercase/whitespace-normalized title and fetchedAt. Provider requests are serial, timeout after 10 seconds, and retry at most three total attempts on network errors, HTTP 429 or 5xx with bounded backoff. Invalid IDs and mismatched provider IDs are rejected.

Use `TMDB_TOKEN` (bearer), `IGDB_CLIENT_ID` plus `IGDB_ACCESS_TOKEN`, and `SPOTIFY_ACCESS_TOKEN` for the required provider types. These are operator-supplied current tokens; the one-off script does not refresh them or initialize the bot. Expired tokens and missing names leave metadata incomplete, produce an ID-only failure record and a nonzero exit status; rerunning resumes missing rows. No title is fabricated. No queue, background job service, Redis, artwork store or public archive endpoint is introduced.

For the intended small database, Mongo cursors use batches of 100 but the audit holds review originals in memory to produce one inspectable manifest. Distinct title IDs are likewise enumerated in memory. Large databases require an independently reviewed streaming strategy. Pure fixture verification: `node --test tests/migration.test.js`. To repeat the isolated Mongo integration tests, use a disposable MongoDB 7 replica set bound to `127.0.0.1:27028` and run:

```sh
BOC_MONGO_TEST_URL='mongodb://127.0.0.1:27028/?replicaSet=boc-tests&directConnection=true' node --test tests/mongo-migration.test.js
```

The suite rejects other hosts/ports, uses only generated `boc_review_web_test*` databases, removes them afterward, and skips by default without that variable. It exercises actual MongoDB archive transactions and title writes; provider responses are fixture-only. Production-backup restore rehearsal, duplicate index restoration, credentials/provider access and actual title coverage remain operational release gates.

The public API fixture suite uses a separate explicit variable:

```sh
REVIEW_WEB_TEST_DATABASE_URL='mongodb://127.0.0.1:27028/boc_review_web_test_web?replicaSet=boc-tests&directConnection=true' node --test tests/web-mongo.test.js
```

It also rejects nonlocal/non-test database names and deletes its fixture database
when finished. Set both test variables when running `yarn test` to include all
integration cases. Ordinary `yarn test` safely skips the three Mongo integration
tests without these variables. See the README for runtime flags and HTTPS/intent
setup. All production actions require separate authorization.
