#!/bin/bash
# Startup script for Bot-Of-Culture GCE VM
# This script runs on VM startup and pulls/runs the latest container

set -e

echo "🚀 Starting Bot-Of-Culture deployment..."

# Get access token from metadata server and configure Docker
echo "🔐 Configuring Docker authentication..."
ENDPOINT="metadata.google.internal/computeMetadata/v1"
ACCOUNT="default"
TOKEN=$(curl --silent --header "Metadata-Flavor: Google" \
  http://${ENDPOINT}/instance/service-accounts/${ACCOUNT}/token)

ACCESS=$(echo ${TOKEN} | grep -oE "(ya29.[0-9a-zA-Z._-]*)")

# Create a temporary directory for Docker config
export DOCKER_CONFIG=/tmp/docker-config
mkdir -p $DOCKER_CONFIG

printf ${ACCESS} | docker --config $DOCKER_CONFIG login https://gcr.io -u oauth2accesstoken --password-stdin

# Get the build ID from instance metadata with proper header
BUILD_ID=$(curl -H "Metadata-Flavor: Google" \
  http://metadata.google.internal/computeMetadata/v1/instance/attributes/bot-build-id 2>/dev/null || echo "latest")

IMAGE="gcr.io/bot-of-culture/bot-of-culture:${BUILD_ID}"

# Clean up old Docker images to free space
echo "🧹 Cleaning up old Docker images..."
docker system prune -af || true

echo "📦 Pulling image: ${IMAGE}"
docker --config $DOCKER_CONFIG pull "${IMAGE}"

# Stop and remove existing container if running
echo "🛑 Stopping existing container..."
docker stop bot-of-culture 2>/dev/null || true
docker rm bot-of-culture 2>/dev/null || true

# Run the new container
echo "▶️  Starting new container..."
docker run -d \
  --name bot-of-culture \
  --restart unless-stopped \
  -e ENV=PROD \
  "${IMAGE}"

echo "✅ Bot-Of-Culture deployment complete!"
echo "📋 Container status:"
docker ps | grep bot-of-culture || echo "Container not found!"
