# Isolated viewer capacity check

This harness serves the actual compiled Express/Prisma viewer, with synthetic
Mongo data and a real Discord client class whose gateway and membership are
stubbed. It does not initialize provider credentials or external services. It never imports the bot entrypoint,
loads secrets, logs in to Discord, or connects to production. A 50ms mock
interaction timer measures event-loop responsiveness; a simple read every two
seconds uses the same Prisma client/pool as the viewer. These are responsiveness
proxies, not real Discord command tests.

Prerequisites: local Docker, repository dependencies. Ports 27028/4319 and the
`cosigned-capacity-*` names must be unused. Do not replace an existing container
or database: inspect it first. Docker Desktop's Linux architecture and CPU quota
do not reproduce a GCE shared-core VM exactly. Mongo is outside the constrained
app container, representing the remote database; its local performance does not
establish Atlas capacity. Each aggregate adds 40ms latency by default.

Build the actual application dependency image, then the fixture entrypoint:

```sh
docker build -t cosigned-capacity-base .
docker build -f scripts/review-web/load/Dockerfile -t cosigned-capacity-load .
docker run -d --name cosigned-capacity-mongo --memory=512m --cpus=1 \
  -p 127.0.0.1:27028:27017 mongo:7 --replSet boc-tests --bind_ip_all \
  --wiredTigerCacheSizeGB 0.25
docker exec cosigned-capacity-mongo mongosh --quiet --eval \
  'rs.initiate({_id:"boc-tests",members:[{_id:0,host:"127.0.0.1:27017"}]})'
node scripts/review-web/load/seed.cjs 600
node scripts/review-web/load/seed.cjs 6000
node scripts/review-web/load/seed.cjs 6000 wide
```

Seeding refuses to overwrite existing named databases. The baseline and dense
growth fixtures use 400 titles; the wide growth fixture has 4,000 titles. All use
84 synthetic users, mixed media, private rows, one opted-out user, copied
attribution and roughly 500-character comments. Tenfold scale increases the
reviews per title/user in the dense fixture, while the wide fixture also increases
distinct-title aggregation work. The actual
migration is deliberately not run: the fixture already has the post-migration
shape and planned indexes.

Start the fixture for the 600-review scale (change the URI suffix to `6000` for
the dense scale, or `6000_wide` for wide growth). Use `host.docker.internal` on Docker Desktop; the URI guard
intentionally rejects arbitrary remote targets.

```sh
docker run -d --name cosigned-capacity-app --memory=384m --memory-swap=384m \
  --cpus=0.25 --cap-drop ALL --security-opt no-new-privileges --read-only \
  --tmpfs /tmp:rw,size=32m --log-opt max-size=5m --log-opt max-file=2 \
  -p 127.0.0.1:4319:4319 \
  -e 'LOAD_DATABASE_URL=mongodb://host.docker.internal:27028/boc_review_web_test_load_600?replicaSet=boc-tests&directConnection=true' \
  -e LOAD_DB_DELAY_MS=40 cosigned-capacity-load
docker logs cosigned-capacity-app
```

Wait for `FIXTURE_READY`. Run these sequentially, with no other benchmark using
the fixture. Each run lasts about 45 seconds plus its overload/recovery check.
The clients stagger initial opens, then request paging, search, profiles or
expanded reviews every four seconds and refresh the library after 30 seconds.
Each run finishes with a separate simultaneous 20-request overload burst.

```sh
node scripts/review-web/load/readers.cjs 1 45000 /tmp/cosigned-load-600-1.json
node scripts/review-web/load/readers.cjs 5 45000 /tmp/cosigned-load-600-5.json
node scripts/review-web/load/readers.cjs 10 45000 /tmp/cosigned-load-600-10.json
```

Recreate only `cosigned-capacity-app` for each 6000-review URI and repeat with
corresponding output names. To stress latency rather than dataset size, use
`LOAD_DB_DELAY_MS=100` in a separately labeled run. Reports include failures and
transport timeouts in counts/latencies, query count, peak process RSS, event-loop
p95/max delay, a 50ms mock bot timer's excess delay, CPU time, burst status counts,
shared-client bot-read p95/max/errors, and independent recovery latency. The memory limit covers the fixture proxy and
app together. Warmed process RSS can carry over between sequential runs; each
phase resets the measured peak to current RSS rather than pretending a cold start.

After inspecting results and running any isolated integration suites, remove
only these named fixtures and their synthetic volume:

```sh
docker rm -f cosigned-capacity-app
docker rm -fv cosigned-capacity-mongo
```

No production throughput guarantee follows from this short test. Establish
production memory/latency monitoring and a small controlled launch separately.
