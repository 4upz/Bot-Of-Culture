#!/bin/bash
# COS boot restoration and explicitly gated container rollout. No image pruning.
set -euo pipefail
umask 077
STATE=${BOT_STATE_DIR:-/var/lib/bot-of-culture}
RUNTIME="$STATE/runtime.env"
NAME=bot-of-culture
fail() { echo "Deployment refused: $*" >&2; exit 1; }
mkdir -p "$STATE"
mkdir "$STATE/deploy.lock" 2>/dev/null || fail 'another deployment holds deploy.lock (inspect before removing a stale lock)'
AUTH=''
trap 'rmdir "$STATE/deploy.lock"; if [[ -n "$AUTH" ]]; then rm -rf "$AUTH"; fi' EXIT

case "${1:-boot}" in
  maintenance)
    # Run BEFORE schema migration; survives reboot without reviving the old writer.
    touch "$STATE/maintenance"
    docker update --restart=no "$NAME"
    docker stop "$NAME"
    exit 0;;
  boot)
    # /etc is ephemeral on COS; /var/lib and Docker volumes are persistent.
    [[ -r "$RUNTIME" ]] || fail 'provision /var/lib/bot-of-culture/runtime.env first'
    [[ ! -e "$STATE/maintenance" ]] || fail 'maintenance gate is active; manual compatible rollout required'
    ETC_DIR=${BOT_ETC_DIR:-/etc/bot-of-culture}
    mkdir -p "$ETC_DIR"
    ln -sfn "$RUNTIME" "$ETC_DIR/runtime.env"
    # Never pull, replace, or start a bot from metadata on boot. Docker only
    # restarts the successfully accepted container according to its policy.
    # COS host firewall is ephemeral. Restore only previously approved ingress.
    if [[ -e "$STATE/caddy-enabled" && -e "$STATE/public-ingress-approved" ]]; then
      [[ -r "${CADDY_CONFIG_PATH:-/var/lib/cosigned/caddy/Caddyfile}" ]] || fail 'Caddyfile missing'
      for port in 80 443; do
        iptables -w -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null ||
          iptables -w -A INPUT -p tcp --dport "$port" -j ACCEPT
      done
      docker start cosigned-https
    fi
    exit 0;;
  rollout) ;;
  *) fail 'usage: startup-script.sh [boot|maintenance|rollout IMAGE ROLLBACK schema-compatible]' ;;
esac
[[ $# == 4 && "$4" == schema-compatible ]] || fail 'explicit schema-compatible rollback attestation required'
IMAGE=$2
ROLLBACK=$3
for ref in "$IMAGE" "$ROLLBACK"; do
  [[ "$ref" =~ ^gcr\.io/[a-z0-9-]+/bot-of-culture@sha256:[a-f0-9]{64}$ ]] || fail 'use immutable bot image digests'
done
[[ -r "$RUNTIME" ]] || fail 'durable runtime.env missing'
grep -qx 'REVIEW_MIGRATION_READY=true' "$RUNTIME" || fail 'migration readiness not recorded'
# This deployment uses the default bridge behind a host-network Caddy. Require
# its discovered gateway explicitly; never trust arbitrary forwarded chains.
GATEWAY=$(docker network inspect bridge --format '{{(index .IPAM.Config 0).Gateway}}')
[[ -n "$GATEWAY" ]] || fail 'Docker bridge gateway unavailable'
grep -Fxq "REVIEW_WEB_TRUSTED_PROXY_IPS=$GATEWAY" "$RUNTIME" || fail 'runtime must explicitly trust the detected bridge gateway; verify Caddy host-network topology'
# A conservative floor, not a guarantee: provision pull/unpack + two retained
# images explicitly. Never reclaim other services or rollback images implicitly.
FREE_KB=$(df -Pk "$STATE" | awk 'END {print $4}')
[[ "$FREE_KB" =~ ^[0-9]+$ && "$FREE_KB" -ge 4194304 ]] || fail 'need at least 4 GiB free before pull; provision/review disk manually'
AUTH=$(mktemp -d)
TOKEN=$(curl --fail --silent --show-error --max-time 15 -H 'Metadata-Flavor: Google' http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token)
ACCESS=$(printf '%s' "$TOKEN" | sed -n 's/.*"access_token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
[[ -n "$ACCESS" ]] || fail 'metadata token missing'
printf '%s' "$ACCESS" | docker --config "$AUTH" login https://gcr.io -u oauth2accesstoken --password-stdin
for ref in "$IMAGE" "$ROLLBACK"; do
  docker --config "$AUTH" pull "$ref"
  # Parse exactly Docker's env-file semantics without loading shell code or
  # contacting Discord/Mongo. Both images must support the approved runtime.
  docker run --rm --network none --env-file "$RUNTIME" --entrypoint node "$ref" -e '
    const e=process.env;
    if(e.REVIEW_MIGRATION_READY!=="true" || e.WEB_ENABLED!=="true" || (e.PORT && e.PORT!=="8080")) process.exit(1);
    const u=new URL(e.PUBLIC_WEB_BASE_URL);
    if(!["http:","https:"].includes(u.protocol)||u.username||u.password||u.pathname!=="/") process.exit(1);
    if(e.REVIEW_WEB_TRUSTED_PROXY_IPS!==process.argv[1] || !require("net").isIP(e.REVIEW_WEB_TRUSTED_PROXY_IPS)) process.exit(1);
  ' "$GATEWAY"
done
FREE_KB=$(df -Pk "$STATE" | awk 'END {print $4}')
[[ "$FREE_KB" =~ ^[0-9]+$ && "$FREE_KB" -ge 1048576 ]] || fail 'less than 1 GiB remaining after pulls'
# Ensure Docker accepted all runtime/resource/port options before any stop.
create_bot() {
  docker create --name "$1" --restart=no --log-driver json-file \
    --log-opt max-size=10m --log-opt max-file=3 --memory=384m --memory-swap=384m \
    --cpus=0.75 -e ENV=PROD --env-file "$RUNTIME" \
    -p 127.0.0.1:8080:8080 "$2"
}
STAGED="bot-of-culture-staged-$(date +%s)-$$"
create_bot "$STAGED" "$IMAGE"
touch "$STATE/maintenance"
# A first rollout, or one after a failed rollback removed the container, has no legacy writer to retire.
if OLD_ID=$(docker inspect --format '{{.Id}}' "$NAME" 2>/dev/null); then
  RETAINED="bot-of-culture-retained-${OLD_ID:0:12}"
  # Every stopped legacy writer has restart disabled BEFORE mutation/cutover.
  docker update --restart=no "$NAME"
  docker stop "$NAME"
  docker rename "$NAME" "$RETAINED"
fi
ready() {
  local stable=0
  for ((i=0; i<45; i++)); do
    if [[ $(docker inspect --format '{{.State.Running}}' "$NAME") == true ]] &&
       [[ $(docker inspect --format '{{.RestartCount}}' "$NAME") == 0 ]] &&
       docker logs "$NAME" 2>&1 | grep -F 'Review web listening on 8080' >/dev/null &&
       curl --fail --silent --max-time 3 http://127.0.0.1:8080/g/0 >/dev/null; then
      stable=$((stable + 1))
      [[ "$stable" -ge 5 ]] && return 0
    else
      stable=0
    fi
    sleep 2
  done
  return 1
}
if docker rename "$STAGED" "$NAME" && docker start "$NAME" && ready; then
  docker update --restart=unless-stopped "$NAME"
  printf '%s\n' "$IMAGE" > "$STATE/accepted-image"
  printf '%s\n' "$ROLLBACK" > "$STATE/compatible-rollback-image"
  rm -f "$STATE/maintenance"
  echo 'Rollout accepted; retained previous container and all images. Caddy unchanged.'
else
  # Only an explicitly attested image may write to the migrated database.
  docker rm -f "$NAME" || true
  if create_bot "$NAME" "$ROLLBACK" && docker start "$NAME" && ready; then
    echo 'Compatible rollback is ready; maintenance gate retained for operator review.' >&2
  else
    docker stop "$NAME" || true
    echo 'Compatible rollback failed readiness; bot stopped, manual recovery required.' >&2
  fi
  exit 1
fi
