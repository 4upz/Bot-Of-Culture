# Caching and Latency Monitoring Setup

This document explains the caching and latency monitoring implementation for the Bot-Of-Culture Discord bot.

## Overview

The bot now includes:
1. **Google Cloud Logging** - End-to-end request latency tracking
2. **Redis Cache** - Media API response caching to reduce latency and API calls

## Local Development Setup

### Running with Docker Compose

The `docker-compose.yml` file includes a Redis service that runs automatically:

```bash
docker-compose up
```

This will start:
- **Redis** on port 6379 with persistent storage
- **Bot application** with environment variables configured to use Redis

### Running Locally (without Docker)

1. Install and start Redis:
   ```bash
   # macOS
   brew install redis
   brew services start redis

   # Ubuntu/Debian
   sudo apt-get install redis-server
   sudo systemctl start redis

   # Windows
   # Download from https://github.com/microsoftarchive/redis/releases
   ```

2. Set environment variables (optional, defaults to localhost:6379):
   ```bash
   export REDIS_HOST=localhost
   export REDIS_PORT=6379
   ```

3. Run the bot:
   ```bash
   yarn dev
   ```

## Production Setup with Google Cloud Memorystore

### Step 1: Create a Memorystore Redis Instance

```bash
# Set your project ID
export PROJECT_ID=bot-of-culture

# Create a Redis instance (M1: 1GB, Basic tier)
gcloud redis instances create bot-cache \
  --size=1 \
  --region=us-central1 \
  --redis-version=redis_7_0 \
  --tier=basic \
  --project=$PROJECT_ID
```

**Pricing Note:** Basic M1 (1GB) costs approximately $50/month.

For high availability, use the `--tier=standard` flag (costs more but provides automatic failover).

### Step 2: Get Connection Information

```bash
# Get the Redis host IP
gcloud redis instances describe bot-cache \
  --region=us-central1 \
  --format="value(host)" \
  --project=$PROJECT_ID
```

This will output an IP address like `10.0.0.3`.

### Step 3: Configure Environment Variables

Add the Redis connection details to your GCP Secret Manager:

```bash
# Create secret for Redis host
echo -n "10.0.0.3" | gcloud secrets create REDIS_HOST \
  --data-file=- \
  --project=$PROJECT_ID

# Create secret for Redis port (default 6379)
echo -n "6379" | gcloud secrets create REDIS_PORT \
  --data-file=- \
  --project=$PROJECT_ID
```

### Step 4: Update GCP Deployment Configuration

The bot's `src/utils/cache.ts` automatically reads from environment variables:
- `REDIS_HOST` - Redis host IP (defaults to `localhost`)
- `REDIS_PORT` - Redis port (defaults to `6379`)
- `REDIS_PASSWORD` - Redis password (optional, only needed if AUTH is enabled)

Update your Cloud Build or Compute Engine startup script to load these from Secret Manager:

```bash
# In your startup script
export REDIS_HOST=$(gcloud secrets versions access latest --secret=REDIS_HOST)
export REDIS_PORT=$(gcloud secrets versions access latest --secret=REDIS_PORT)
```

### Step 5: Network Configuration

Ensure your Compute Engine VM or Cloud Run service can access Memorystore:

1. **Compute Engine VM**: Must be in the same VPC network as Memorystore
2. **Cloud Run**: Requires VPC connector setup

For Compute Engine (already configured in your case):
```bash
# Verify your VM is in the same network as Memorystore
gcloud redis instances describe bot-cache \
  --region=us-central1 \
  --format="value(authorizedNetwork)"
```

### Step 6: Deploy

Deploy your bot using your existing deployment process:

```bash
yarn deploy:prod
```

## Monitoring Logs in Google Cloud

### Viewing Latency Logs

1. Go to [Google Cloud Logging](https://console.cloud.google.com/logs)
2. Select your project: `bot-of-culture`
3. Use these filters to view specific logs:

**View all API call latencies:**
```
resource.type="global"
logName="projects/bot-of-culture/logs/bot-of-culture-app"
jsonPayload.apiLatencyMs>0
```

**View cache hits vs misses:**
```
resource.type="global"
logName="projects/bot-of-culture/logs/bot-of-culture-app"
jsonPayload.cacheHit=true
```

**View end-to-end request latency:**
```
resource.type="global"
logName="projects/bot-of-culture/logs/bot-of-culture-app"
jsonPayload.commandName!=""
```

**View slow requests (over 500ms):**
```
resource.type="global"
logName="projects/bot-of-culture/logs/bot-of-culture-app"
jsonPayload.latencyMs>500
```

### Creating Log-Based Metrics

Create custom metrics to track performance over time:

1. Go to [Logs Explorer](https://console.cloud.google.com/logs/query)
2. Click "Create Metric"
3. Use these examples:

**Average API Latency:**
- Name: `api_latency_avg`
- Filter: `jsonPayload.apiLatencyMs>0`
- Metric Type: Distribution
- Field: `jsonPayload.apiLatencyMs`

**Cache Hit Rate:**
- Name: `cache_hit_rate`
- Filter: `jsonPayload.cacheHit=true OR jsonPayload.cacheHit=false`
- Metric Type: Counter
- Label: `jsonPayload.cacheHit`

**Request Count by Command:**
- Name: `requests_by_command`
- Filter: `jsonPayload.commandName!=""`
- Metric Type: Counter
- Label: `jsonPayload.commandName`

## Cache Configuration

Cache TTLs are configured in `src/utils/cache.ts`:

```typescript
export const CacheTTL = {
  SEARCH_RESULTS: 600,   // 10 minutes - for search queries
  MEDIA_DETAILS: 3600,   // 1 hour - for media details by ID
  AUTH_TOKEN: 3500,      // ~1 hour - for OAuth tokens
}
```

You can adjust these values based on your needs:
- **Lower TTL**: More API calls, fresher data
- **Higher TTL**: Fewer API calls, potential stale data

## Cache Invalidation

To manually clear cache entries:

### Local Redis
```bash
redis-cli
> KEYS MovieService:*    # View all movie service cache keys
> DEL MovieService:search:abc123   # Delete specific key
> FLUSHDB                # Clear entire cache (use with caution)
```

### Google Cloud Memorystore
```bash
# Connect via a Compute Engine VM in the same network
gcloud compute ssh your-vm-name --zone=us-central1-a

# Then use redis-cli as above
redis-cli -h YOUR_MEMORYSTORE_IP
```

## Troubleshooting

### Cache Not Working
1. Check Redis connection:
   ```bash
   redis-cli ping
   # Should return: PONG
   ```

2. Check bot logs for Redis connection errors:
   ```
   [WARNING] Redis connection error, cache disabled
   ```

3. Verify environment variables are set:
   ```bash
   echo $REDIS_HOST
   echo $REDIS_PORT
   ```

### High Latency Despite Caching
1. Check cache hit rate in logs
2. Verify TTL values are appropriate
3. Monitor Redis memory usage (may need larger instance)

### Logs Not Appearing in Google Cloud
1. Verify `GOOGLE_APPLICATION_CREDENTIALS` is set
2. Check service account has `roles/logging.logWriter` permission
3. Look for fallback console logs (they still appear even if Cloud Logging fails)

## Architecture Summary

```
User → Discord Bot → Interaction Handler (starts timer)
                          ↓
                     Command Execution
                          ↓
                    Service Layer (checks cache)
                          ↓
                   ┌──────┴──────┐
                   ↓             ↓
              Cache Hit      Cache Miss
                   ↓             ↓
            Return Cached   Call External API
            Data (5ms)           ↓
                              Cache Result
                                 ↓
                          Return Fresh Data
                              (200-500ms)
                                 ↓
                          End Timer & Log
                                 ↓
                          Send Discord Response
```

## Expected Performance Improvements

**Before Caching:**
- Search request: 200-500ms (per API call)
- Multiple users searching same media: N × API latency

**After Caching:**
- First search (cache miss): 200-500ms + cache write overhead (~5ms)
- Subsequent searches (cache hit): 5-10ms
- **40-100x faster for cached requests**

**Example Scenario:**
- New movie "Dune 3" releases
- User A searches for "Dune 3" → 300ms (cache miss)
- User B searches for "Dune 3" (5 min later) → 5ms (cache hit) → **60x faster!**
- 10 more users review "Dune 3" in next hour → All hit cache → **Significant API cost savings**
