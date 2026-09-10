#!/bin/bash
# Runs on the VM. Routine releases use the accepted production image as recovery.
set -euo pipefail
umask 077
fail() { echo "Automatic deployment refused: $*" >&2; exit 1; }
[[ $# == 4 ]] || fail 'expected IMAGE BUILD_ORDER COMMIT STARTUP_CHECKSUM'
IMAGE=$1
ORDER=$2
COMMIT=$3
STARTUP_CHECKSUM=$4
[[ "$IMAGE" =~ ^gcr\.io/bot-of-culture/bot-of-culture@sha256:[a-f0-9]{64}$ ]] || fail 'invalid immutable image'
[[ "$ORDER" =~ ^[1-9][0-9]{0,15}$ ]] || fail 'invalid build order'
[[ "$COMMIT" =~ ^[a-f0-9]{40}$ && "$STARTUP_CHECKSUM" =~ ^[a-f0-9]{64}$ ]] || fail 'invalid source identity'
STATE=${BOT_STATE_DIR:-/var/lib/bot-of-culture}
[[ -d "$STATE" ]] || fail 'production state missing'
exec 9>"$STATE/auto-deploy.lock"
flock -w 600 9 || fail 'another automatic deployment is still running'
[[ ! -e "$STATE/maintenance" ]] || fail 'maintenance is active; resolve it before automatic rollout'
PREVIOUS_ORDER=0
if [[ -f "$STATE/last-deploy-order" ]]; then
  PREVIOUS_ORDER=$(cat "$STATE/last-deploy-order")
fi
[[ "$PREVIOUS_ORDER" =~ ^(0|[1-9][0-9]{0,15})$ ]] || fail 'invalid saved build order'
if [[ "$ORDER" -lt "$PREVIOUS_ORDER" ]]; then
  echo 'Skipping an older build; a newer deployment has already started.'
  exit 0
fi
ACTUAL_CHECKSUM=$(sha256sum "$STATE/startup-script.sh" | awk '{print $1}')
[[ "$ACTUAL_CHECKSUM" == "$STARTUP_CHECKSUM" ]] || fail 'installed startup script differs from reviewed source; stage it first'
ROLLBACK=$(cat "$STATE/accepted-image")
[[ "$ROLLBACK" =~ ^gcr\.io/bot-of-culture/bot-of-culture@sha256:[a-f0-9]{64}$ ]] || fail 'accepted recovery image missing'
RUNNING_IMAGE=$(docker inspect --format '{{.Config.Image}}' bot-of-culture)
[[ "$RUNNING_IMAGE" == "$ROLLBACK" ]] || fail 'running container differs from the accepted image'
# Record the high-water mark before rollout so an older build cannot follow a
# failed or interrupted newer attempt. Retrying the same build remains possible.
printf '%s\n' "$ORDER" > "$STATE/last-deploy-order.tmp"
mv "$STATE/last-deploy-order.tmp" "$STATE/last-deploy-order"
bash "$STATE/startup-script.sh" auto-rollout "$IMAGE" "$ROLLBACK" schema-compatible
printf '%s\n' "$COMMIT" > "$STATE/accepted-commit.tmp"
mv "$STATE/accepted-commit.tmp" "$STATE/accepted-commit"
echo "Automatic deployment accepted for commit $COMMIT."
