import Redis from 'ioredis';
import { createHash } from 'crypto';
import { logger } from './logger';

// TTL configurations (in seconds)
export const CacheTTL = {
  SEARCH_RESULTS: 600, // 10 minutes - balances freshness with cache hits during review spikes
  MEDIA_DETAILS: 3600, // 1 hour - media details rarely change
  AUTH_TOKEN: 3500, // ~1 hour - slightly less than token expiry
} as const;

/**
 * Redis cache manager for API responses
 */
class CacheManager {
  private client: Redis | null = null;
  private isConnected: boolean = false;
  private connectionAttempted: boolean = false;

  constructor() {
    this.initializeClient();
  }

  /**
   * Initialize Redis client
   */
  private initializeClient(): void {
    try {
      const redisHost = process.env.REDIS_HOST || 'localhost';
      const redisPort = parseInt(process.env.REDIS_PORT || '6379', 10);
      const redisPassword = process.env.REDIS_PASSWORD;

      this.client = new Redis({
        host: redisHost,
        port: redisPort,
        password: redisPassword,
        maxRetriesPerRequest: 3,
        retryStrategy: (times: number) => {
          if (times > 3) {
            logger.warn('Redis max retries reached, disabling cache');
            return null; // Stop retrying
          }
          const delay = Math.min(times * 100, 3000);
          return delay;
        },
        enableOfflineQueue: false, // Don't queue commands when disconnected
        lazyConnect: true, // Don't connect immediately
      });

      // Event handlers
      this.client.on('connect', () => {
        this.isConnected = true;
        logger.info('Redis cache connected', {
          service: 'CacheManager',
          redisHost,
          redisPort,
        });
      });

      this.client.on('ready', () => {
        this.isConnected = true;
      });

      this.client.on('error', (error) => {
        this.isConnected = false;
        logger.warn('Redis connection error, cache disabled', {
          service: 'CacheManager',
          error: error.message,
        });
      });

      this.client.on('close', () => {
        this.isConnected = false;
      });

      // Attempt connection (lazy)
      this.client.connect().catch((error) => {
        logger.warn('Failed to connect to Redis, running without cache', {
          service: 'CacheManager',
          error: error.message,
        });
      });

      this.connectionAttempted = true;
    } catch (error) {
      logger.error('Failed to initialize Redis client', {
        service: 'CacheManager',
        error: error instanceof Error ? error.message : String(error),
      });
      this.client = null;
      this.isConnected = false;
    }
  }

  /**
   * Generate a cache key from service, method, and parameters
   */
  private generateKey(service: string, method: string, params: any): string {
    const paramHash = createHash('md5')
      .update(JSON.stringify(params))
      .digest('hex')
      .substring(0, 16);
    return `${service}:${method}:${paramHash}`;
  }

  /**
   * Get a value from cache
   * @returns Cached value or null if not found
   */
  async get<T>(service: string, method: string, params: any): Promise<T | null> {
    if (!this.isConnected || !this.client) {
      return null;
    }

    try {
      const key = this.generateKey(service, method, params);
      const value = await this.client.get(key);

      if (value) {
        return JSON.parse(value) as T;
      }

      return null;
    } catch (error) {
      logger.warn('Cache get failed', {
        service: 'CacheManager',
        method: 'get',
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Set a value in cache with TTL
   */
  async set(
    service: string,
    method: string,
    params: any,
    value: any,
    ttl: number
  ): Promise<void> {
    if (!this.isConnected || !this.client) {
      return;
    }

    try {
      const key = this.generateKey(service, method, params);
      const serialized = JSON.stringify(value);
      await this.client.setex(key, ttl, serialized);
    } catch (error) {
      logger.warn('Cache set failed', {
        service: 'CacheManager',
        method: 'set',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Invalidate cache entries matching a pattern
   */
  async invalidate(service: string, method?: string): Promise<void> {
    if (!this.isConnected || !this.client) {
      return;
    }

    try {
      const pattern = method ? `${service}:${method}:*` : `${service}:*`;
      const keys = await this.client.keys(pattern);

      if (keys.length > 0) {
        await this.client.del(...keys);
        logger.info('Cache invalidated', {
          service: 'CacheManager',
          pattern,
          keysDeleted: keys.length,
        });
      }
    } catch (error) {
      logger.warn('Cache invalidation failed', {
        service: 'CacheManager',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Check if cache is available
   */
  isAvailable(): boolean {
    return this.isConnected && this.client !== null;
  }

  /**
   * Close the Redis connection
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.isConnected = false;
    }
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<{ connected: boolean; keyCount?: number }> {
    if (!this.isConnected || !this.client) {
      return { connected: false };
    }

    try {
      const keyCount = await this.client.dbsize();
      return { connected: true, keyCount };
    } catch (error) {
      return { connected: false };
    }
  }
}

// Export singleton instance
export const cache = new CacheManager();
