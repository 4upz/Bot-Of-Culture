#!/bin/bash
# Cloud Build entry point; the Docker push step must complete before this runs.
set -euo pipefail
[[ $# == 5 ]] || { echo 'Expected PROJECT BUILD_ID COMMIT BRANCH TRIGGER' >&2; exit 1; }
PROJECT=$1
BUILD_ID=$2
COMMIT=$3
BRANCH=$4
TRIGGER=$5
if [[ "$PROJECT" != bot-of-culture || "$BRANCH" != master || "$TRIGGER" != deploy-bot-of-culture ]]; then
  echo 'Image published; automatic rollout is only enabled for the production master trigger.'
  exit 0
fi
[[ "$BUILD_ID" =~ ^[a-f0-9-]{36}$ && "$COMMIT" =~ ^[a-f0-9]{40}$ ]] || { echo 'Invalid build identity' >&2; exit 1; }
TAG="gcr.io/$PROJECT/bot-of-culture:$BUILD_ID"
DIGEST=$(gcloud container images describe "$TAG" --project "$PROJECT" --format='value(image_summary.digest)')
[[ "$DIGEST" =~ ^sha256:[a-f0-9]{64}$ ]] || { echo 'Published image digest unavailable' >&2; exit 1; }
CREATED=$(gcloud builds describe "$BUILD_ID" --project "$PROJECT" --format='value(createTime)')
ORDER=$(python3 -c 'import datetime,sys; d=datetime.datetime.fromisoformat(sys.argv[1].replace("Z", "+00:00")); print(int(d.timestamp()*1000000))' "$CREATED")
CHECKSUM=$(sha256sum startup-script.sh | awk '{print $1}')
REMOTE="/tmp/boc-auto-deploy-$BUILD_ID.sh"
VM=bocdeploy@bot-of-culture
mkdir -p "$HOME/.ssh"
SSH_FLAGS=(--project "$PROJECT" --zone us-central1-c --quiet --ssh-key-file=/tmp/boc-deploy-key --ssh-key-expire-after=30m)
gcloud compute scp scripts/deployment/auto-rollout.sh "$VM:$REMOTE" "${SSH_FLAGS[@]}"
trap 'gcloud compute ssh "$VM" "${SSH_FLAGS[@]}" --command="rm -f -- $REMOTE" || true' EXIT
gcloud compute ssh "$VM" "${SSH_FLAGS[@]}" \
  --command="sudo bash $REMOTE gcr.io/$PROJECT/bot-of-culture@$DIGEST $ORDER $COMMIT $CHECKSUM"
