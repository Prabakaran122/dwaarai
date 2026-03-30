import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

let client = null;
let connected = false;

// Cache stats counters
let cacheHits = 0;
let cacheMisses = 0;

function createClient() {
  if (client) return client;

  client = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 1,
    retryStrategy(times) {
      if (times > 3) return null; // stop retrying after 3 attempts
      return Math.min(times * 200, 2000);
    },
    lazyConnect: false,
  });

  client.on('connect', () => {
    connected = true;
    console.log('Redis connected');
  });

  client.on('error', (err) => {
    connected = false;
    console.error('Redis error:', err.message);
  });

  client.on('close', () => {
    connected = false;
  });

  return client;
}

// Initialize on import
createClient();

/**
 * Get a cached value by key. Returns parsed JSON or null on miss/error.
 */
export async function getCache(key) {
  try {
    if (!connected) {
      cacheMisses++;
      return null;
    }
    const raw = await client.get(key);
    if (raw === null) {
      cacheMisses++;
      return null;
    }
    cacheHits++;
    return JSON.parse(raw);
  } catch (err) {
    console.error('Redis getCache error:', err.message);
    cacheMisses++;
    return null;
  }
}

/**
 * Set a cached value with a TTL in seconds.
 */
export async function setCache(key, value, ttlSeconds) {
  try {
    if (!connected) return;
    await client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  } catch (err) {
    console.error('Redis setCache error:', err.message);
  }
}

/**
 * Delete a cached key (or pattern using key array).
 */
export async function delCache(key) {
  try {
    if (!connected) return;
    if (Array.isArray(key)) {
      if (key.length > 0) await client.del(...key);
    } else {
      await client.del(key);
    }
  } catch (err) {
    console.error('Redis delCache error:', err.message);
  }
}

/**
 * Delete all keys matching a glob pattern (e.g. "access:*:anpr:ABC123").
 * Uses SCAN to avoid blocking Redis.
 */
export async function delCachePattern(pattern) {
  try {
    if (!connected) return;
    let cursor = '0';
    do {
      const [nextCursor, keys] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = nextCursor;
      if (keys.length > 0) {
        await client.del(...keys);
      }
    } while (cursor !== '0');
  } catch (err) {
    console.error('Redis delCachePattern error:', err.message);
  }
}

/**
 * Get cache hit/miss statistics.
 */
export function getCacheStats() {
  return { hits: cacheHits, misses: cacheMisses, connected };
}

/**
 * Reset cache stats counters.
 */
export function resetCacheStats() {
  cacheHits = 0;
  cacheMisses = 0;
}

/**
 * Get the raw ioredis client instance.
 */
export function getRedisClient() {
  return client;
}
