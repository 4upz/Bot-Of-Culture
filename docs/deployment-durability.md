# Controlled COS deployment

The GitHub-connected `deploy-bot-of-culture` trigger watches `4upz/Bot-Of-Culture` on `master`. Cloud Build builds the Docker image, explicitly pushes its build-specific tag, resolves the immutable digest, and invokes the existing container rollout over SSH. Publishing an image alone does not update this VM: the rollout step replaces the running bot container. Caddy, its certificate volumes, and the VM remain running.

## Automatic releases

`scripts/deployment/deploy-from-build.sh` only deploys builds carrying the production project, `master` branch, and expected trigger name. Other builds publish their images without deploying. It uses the existing Cloud Build service account and an expiring SSH key for the `bocdeploy` VM user; no service account keys or application secrets are copied into the build.

On the VM, `auto-rollout.sh` waits for the automatic deployment lock, respects maintenance, and verifies that the installed startup script matches the source checksum and the running container matches the accepted release. It passes the currently accepted immutable image as rollback to the existing rollout script's `auto-rollout` mode. That mode rechecks maintenance and image identity under the same deployment lock as manual operations, preventing a concurrent release from undoing maintenance. A build creation timestamp prevents an older overlapping build from replacing a newer attempt. The source commit is recorded in `accepted-commit` after success. Failed rollout/readiness returns a failed Cloud Build result and retains the existing maintenance/recovery behavior.

This is for compatible application releases. Before an incompatible database migration, enter maintenance and follow the separate migration/recovery procedure. Changes to `startup-script.sh` must be reviewed and staged on the VM before automated rollout can use them; a checksum mismatch fails before stopping the bot. Disable the Cloud Build trigger to pause builds, or use maintenance below to pause releases and writers.

## Release gates

The first global-review migration and production cutover are complete; see [the release record](validation/2026-09-10-cutover-readiness.md). For future incompatible schema changes, complete the backup, rehearsal, migration/index verification, and compatible recovery preparation before resuming releases. Stop writers **before** migrating with the staged script's `maintenance` mode and verify that they stopped. Never start the retained legacy writer against the migrated database.

For a schema-changing release, select and independently validate a **schema-compatible** rollback digest; the previous production image may not be valid. A compatible, tested recovery image must be available before rollout. Rollout does not migrate or restore the database. Passing `schema-compatible` is an attestation of this external evidence, not a compatibility check performed by Docker. Routine automatic releases use the already accepted production image and must remain compatible with it.

The production boot disk was expanded to 20 GiB during cutover. Rollout refuses below 4 GiB free before pulling both images and 1 GiB after pulling. Measure actual image/layer sizes and provision enough capacity for the candidate, recovery image, Docker overhead, and logs. A failed pull leaves the current bot alone. Images are retained; disk resizing and cleanup are separate operations.

## Durable configuration and proxy

Provision `/var/lib/bot-of-culture/runtime.env`, root-owned and mode `0600`. Do not commit secrets. Include the existing application configuration and these release settings:

```dotenv
REVIEW_MIGRATION_READY=true
WEB_ENABLED=true
PORT=8080
PUBLIC_WEB_BASE_URL=https://YOUR_APPROVED_HOST
REVIEW_WEB_TRUSTED_PROXY_IPS=THE_VERIFIED_DOCKER_BRIDGE_GATEWAY
```

The supplied rollout requires the viewer enabled so startup readiness can be checked after Discord login and service initialization. It discovers the default bridge gateway with `docker network inspect bridge --format '{{(index .IPAM.Config 0).Gateway}}'` and requires exactly that explicit trusted IP. This assumes the staged Caddy uses host networking and connects to `127.0.0.1:8080`, which Docker forwards from the bridge gateway. Verify this immediate peer in staging; if the network topology differs, adapt and test the deployment before proceeding. Do not add broad CIDRs or trust arbitrary forwarded addresses. The origin remains bound to host loopback.

On COS boot, the script restores the `/etc/bot-of-culture/runtime.env` symlink from persistent state idempotently. Docker container settings, log bounds, and volume mounts persist in Docker state. COS host firewall settings are ephemeral. Only when both Caddy approval flags below exist, boot restores the exact IPv4 TCP INPUT accept rules for ports 80 and 443 with idempotent `iptables -C` / `iptables -A` operations before starting Caddy. With either flag absent it makes no firewall changes. It does not alter GCP firewall rules or DNS. IPv6 and UDP/HTTP3 ingress are not enabled.

Caddy is running for `cosignedapp.com` and is unchanged by rollouts. Its configuration remains `/var/lib/cosigned/caddy/Caddyfile`; preserve the `cosigned_caddy_data` and `cosigned_caddy_config` volumes. Boot starts the existing `cosigned-https` container only when both `/var/lib/bot-of-culture/caddy-enabled` and `/var/lib/bot-of-culture/public-ingress-approved` exist and maintenance is absent. Those flags were installed during the approved public cutover. Preserve its volume mounts, host networking, 128 MiB limit, and bounded Docker logging.

## Stage and invoke manually

When changing the rollout/boot script, copy the reviewed script to a temporary path using SSH/SCP, check it with `bash -n`, compare its checksum with the reviewed local file, and install it as root at `/var/lib/bot-of-culture/startup-script.sh` with mode `0700`. Install the same file as the instance `startup-script` metadata using `gcloud compute instances add-metadata --metadata-from-file=startup-script=...`. This updates future boot behavior without resetting the VM. Routine application releases reuse the already installed script automatically.

For the schema-changing cutover, before migration:

```sh
sudo bash /var/lib/bot-of-culture/startup-script.sh maintenance
```

After the independent release gates, invoke through the approved SSH connection:

```sh
sudo bash /var/lib/bot-of-culture/startup-script.sh rollout \
  'gcr.io/PROJECT/bot-of-culture@sha256:CANDIDATE_DIGEST' \
  'gcr.io/PROJECT/bot-of-culture@sha256:COMPATIBLE_ROLLBACK_DIGEST' \
  schema-compatible
```

The script validates immutable references, runtime configuration, disk capacity, both pulls and Docker container creation before stopping the current bot. It keeps the previous container under a name containing its container ID, disables its restart policy, and retains every image. The candidate has a 384 MiB memory ceiling, no swap, 0.75 CPU burst ceiling, and three 10 MB log files. These are safeguards pending measured capacity; CPU quota does not represent the e2-micro's sustained entitlement.

Readiness requires a running container without restarts, the post-login `Review web listening on 8080` startup log, and five consecutive successful local page requests, two seconds apart. This is process/static-page startup readiness only. It does not prove database availability, production query latency, Discord roster completeness, or migration correctness. Before enabling public ingress, manually verify an actual eligible guild API/page against the migrated database and authoritative member snapshot, including privacy filtering; this functional release gate remains separate from automated startup acceptance. Failure removes only the failed active bot container, starts only the explicitly compatible rollback image with the same configuration, and checks its readiness. If recovery fails, the bot is stopped. Failure leaves maintenance set and returns nonzero even if compatible recovery succeeds; inspect logs before further action. Retained legacy containers are never restarted. A successful candidate receives `unless-stopped`, records its accepted/compatible rollback digests, and clears maintenance.

Unexpected Docker/control-plane failures may stop the rollout with maintenance retained; inspect named containers before recovery. A process kill may leave `deploy.lock`; verify no rollout is running before removing that exact directory. A precreated `bot-of-culture-staged-*` container may also remain after an interrupted cutover. Inspect before removing an exact orphan name. Never run blanket Docker pruning. If cleanup is needed, explicitly identify the current accepted image, compatible rollback image, and retained previous image first, and remove only separately reviewed obsolete bot containers/images. Never remove Caddy containers or volumes to make space.

## Offline checks

```sh
bash -n startup-script.sh
python3 scripts/deployment/test_rollout.py
python3 scripts/deployment/test_auto_rollout.py
```

Mocked tests cover failed pull/config/disk checks before stop, retention on success, maintenance boot refusal, dual-flag/idempotent boot firewall restoration, and compatibility-only rollback after readiness failure. They do not exercise GCP, real COS boot, registry unpack space, actual Docker port binding, or production Discord/MongoDB readiness. Those remain controlled staging/operator checks.
