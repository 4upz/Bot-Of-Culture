# Controlled COS deployment

Cloud Build now **builds and publishes only**. It does not change VM metadata, reset the VM, stop the bot, migrate MongoDB, or start Caddy. The published build tag must be resolved to its immutable `gcr.io/PROJECT/bot-of-culture@sha256:…` digest before manual rollout. These instructions are a future operator procedure; no production deployment was performed as part of this change.

## Release gates

Before the first global-review release, complete the fresh backup, approved winner-exception audit and migration rehearsal, production migration/index verification, and Server Members Intent enablement. Disable the old writer's restart policy and stop it **before** migrating, using the staged script's `maintenance` mode. Check that this succeeded before changing any data. The durable maintenance marker alone cannot prevent Docker from restarting a container whose policy has not yet been disabled. Never start the retained legacy container against the migrated database.

Select and independently validate a **schema-compatible** rollback digest. For this schema-changing release the legacy production image is not a valid rollback. A compatible, tested recovery image must be available; if it is not, keep the deployment gated. Rollout does not migrate or restore the database. Passing `schema-compatible` is the operator's attestation of this external evidence, not a compatibility check performed by Docker.

The observed state partition had only 825 MB free. Rollout refuses below 4 GiB free before pulling both images and 1 GiB after pulling. These conservative floors do not prove sufficient unpack capacity: measure actual image/layer sizes and provision enough disk for candidate, compatible rollback, current image, Docker overhead and logs. A failed pull leaves the current bot alone. There is no automatic disk resize, purchase, pruning, or image removal. The existing boot disk is 10 GiB `pd-balanced` in `us-central1`. A concrete option is 20 GiB, adding approximately US$1/month at the listed US$0.000136986 per GiB-hour (730-hour estimate, before any tax or snapshot storage). [Google Cloud disk pricing](https://cloud.google.com/compute/disks-image-pricing?hl=en). This option requires separate approval; it has not been applied.

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

On COS boot, the script restores the `/etc/bot-of-culture/runtime.env` symlink from persistent state idempotently. Docker container settings, log bounds, and volume mounts persist in Docker state. COS host firewall settings are ephemeral. Only when both Caddy approval flags below exist, boot restores the exact IPv4 TCP INPUT accept rules for ports 80 and 443 with idempotent `iptables -C` / `iptables -A` operations before starting Caddy. With either flag absent it makes no firewall changes. It does not alter GCP firewall rules or DNS; those permission gates remain outstanding. IPv6 and UDP/HTTP3 ingress are not enabled.

Caddy is unchanged by rollouts. Its staged configuration remains `/var/lib/cosigned/caddy/Caddyfile`; preserve the `cosigned_caddy_data` and `cosigned_caddy_config` volumes. Boot starts the existing `cosigned-https` container only when both `/var/lib/bot-of-culture/caddy-enabled` and `/var/lib/bot-of-culture/public-ingress-approved` exist and maintenance is absent. Do not create these flags until public exposure and the gated boot firewall restoration are explicitly approved and readiness is verified. Keep Caddy stopped now. Before enabling it, verify its volume mounts, host networking, 128 MiB limit and bounded Docker logging; log driver options require a controlled recreation of that named container if absent, preserving both volumes.

## Stage and invoke manually

After approval to operate on the VM, copy the reviewed script to a temporary path using SSH/SCP, check it with `bash -n`, compare its checksum with the reviewed local file, and install it as root at `/var/lib/bot-of-culture/startup-script.sh` with mode `0700`. Install the same reviewed file as the instance `startup-script` metadata using `gcloud compute instances add-metadata --metadata-from-file=startup-script=...` from the operator workstation. This installs future boot behavior; do not reset the VM. There is intentionally no deployment-enable substitution in Cloud Build.

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
```

Mocked tests cover failed pull/config/disk checks before stop, retention on success, maintenance boot refusal, dual-flag/idempotent boot firewall restoration, and compatibility-only rollback after readiness failure. They do not exercise GCP, real COS boot, registry unpack space, actual Docker port binding, or production Discord/MongoDB readiness. Those remain controlled staging/operator checks.
