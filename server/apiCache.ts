/**
 * API Cache + Rate Limiter
 *
 * Unified caching and rate limiting for all external API calls.
 * Prevents rate limit errors from Shopify, Anthropic, OpenAI, YouTube, Reddit.
 *
 * Usage:
 *   import { shopifyCache, anthropicLimiter, cachedApiCall } from './apiCache';
 *   const products = await cachedApiCall('shopify:products', () => fetchProducts(), { ttlMs: 3600000, limiter: shopifyLimiter });
 */

interface CacheEntry<T = unknown> {
  value: T;
  expires: number;
  hits: number;
}

interface CacheStats {
  entries: number;
  hits: number;
  misses: number;
  evictions: number;
  byPrefix: Record<string, { entries: number; hits: number }>;
}

export class ApiCache {
  private cache = new Map<string, CacheEntry>();
  private stats = { hits: 0, misses: 0, evictions: 0 };
  private maxEntries: number;
  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor(maxEntries = 5000) {
    this.maxEntries = maxEntries;
    // Cleanup expired entries every 60 seconds
    this.cleanupInterval = setInterval(() => this.cleanup(), 60_000);
  }

  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) {
      this.stats.misses++;
      return null;
    }
    if (Date.now() > entry.expires) {
      this.cache.delete(key);
      this.stats.misses++;
      return null;
    }
    entry.hits++;
    this.stats.hits++;
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    // Evict oldest if at capacity
    if (this.cache.size >= this.maxEntries) {
      const oldest = this.cache.keys().next().value;
      if (oldest) {
        this.cache.delete(oldest);
        this.stats.evictions++;
      }
    }
    this.cache.set(key, {
      value,
      expires: Date.now() + ttlMs,
      hits: 0,
    });
  }

  invalidate(pattern: string): number {
    let count = 0;
    Array.from(this.cache.keys()).forEach((key) => {
      if (key.startsWith(pattern) || key.includes(pattern)) {
        this.cache.delete(key);
        count++;
      }
    });
    return count;
  }

  clear(): void {
    this.cache.clear();
  }

  getStats(): CacheStats {
    const byPrefix: Record<string, { entries: number; hits: number }> = {};
    this.cache.forEach((entry, key) => {
      const prefix = key.split(':')[0] || 'unknown';
      if (!byPrefix[prefix]) byPrefix[prefix] = { entries: 0, hits: 0 };
      byPrefix[prefix].entries++;
      byPrefix[prefix].hits += entry.hits;
    });
    return {
      entries: this.cache.size,
      hits: this.stats.hits,
      misses: this.stats.misses,
      evictions: this.stats.evictions,
      byPrefix,
    };
  }

  private cleanup(): void {
    const now = Date.now();
    Array.from(this.cache.entries()).forEach(([key, entry]) => {
      if (now > entry.expires) {
        this.cache.delete(key);
      }
    });
  }

  destroy(): void {
    clearInterval(this.cleanupInterval);
    this.cache.clear();
  }
}


/**
 * Token bucket rate limiter with async waiting.
 * Automatically refills tokens over time.
 */
export class RateLimiter {
  private tokens: number;
  private maxTokens: number;
  private refillRate: number; // tokens per second
  private lastRefill: number;
  private queue: Array<{ resolve: () => void }> = [];
  private drainInterval: ReturnType<typeof setInterval>;
  public name: string;

  constructor(opts: { name: string; maxTokens: number; refillRate: number }) {
    this.name = opts.name;
    this.maxTokens = opts.maxTokens;
    this.tokens = opts.maxTokens;
    this.refillRate = opts.refillRate;
    this.lastRefill = Date.now();
    // Drain queue every 100ms
    this.drainInterval = setInterval(() => this.drainQueue(), 100);
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }

  async acquire(): Promise<void> {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens--;
      return;
    }
    // Wait in queue until a token is available
    return new Promise<void>((resolve) => {
      this.queue.push({ resolve });
    });
  }

  private drainQueue(): void {
    this.refill();
    while (this.queue.length > 0 && this.tokens >= 1) {
      this.tokens--;
      const next = this.queue.shift();
      next?.resolve();
    }
  }

  getStatus(): { available: number; queued: number; max: number } {
    this.refill();
    return {
      available: Math.floor(this.tokens),
      queued: this.queue.length,
      max: this.maxTokens,
    };
  }

  destroy(): void {
    clearInterval(this.drainInterval);
    // Resolve any remaining queue entries
    for (const entry of this.queue) entry.resolve();
    this.queue = [];
  }
}


// ── Pre-configured instances ──

export const cache = new ApiCache(5000);

// Shopify: 40 requests per app per store per minute (leak rate 2/sec)
export const shopifyLimiter = new RateLimiter({
  name: 'shopify',
  maxTokens: 38, // leave 2 token buffer
  refillRate: 0.63, // ~38 per minute
});

// Anthropic: conservative limits to avoid 429s
export const anthropicLimiter = new RateLimiter({
  name: 'anthropic',
  maxTokens: 40,
  refillRate: 0.8, // ~48 per minute
});

// OpenAI: GPT-4V has lower limits
export const openaiLimiter = new RateLimiter({
  name: 'openai',
  maxTokens: 30,
  refillRate: 0.5,
});

// YouTube Data API: 10,000 units/day, ~100 search queries/day
export const youtubeLimiter = new RateLimiter({
  name: 'youtube',
  maxTokens: 10,
  refillRate: 0.07, // ~4 per minute, conservative
});

// Reddit: public JSON API, be polite
export const redditLimiter = new RateLimiter({
  name: 'reddit',
  maxTokens: 10,
  refillRate: 0.17, // ~10 per minute
});


// ── TTL presets (milliseconds) ──

export const TTL = {
  SHOPIFY_PRODUCTS: 4 * 60 * 60 * 1000,   // 4 hours — products rarely change
  SHOPIFY_ARTICLES: 30 * 60 * 1000,        // 30 min
  RESEARCH_REDDIT: 24 * 60 * 60 * 1000,    // 24 hours — research results stable
  RESEARCH_YOUTUBE: 24 * 60 * 60 * 1000,   // 24 hours
  RESEARCH_WEB: 12 * 60 * 60 * 1000,       // 12 hours
  CONTEXT_ENTRIES: 60 * 60 * 1000,          // 1 hour
  KEYWORD_CLUSTERS: 30 * 60 * 1000,         // 30 min
  PHOTO_ANALYSIS: 7 * 24 * 60 * 60 * 1000, // 7 days — photos don't change
} as const;


/**
 * Cached + rate-limited API call wrapper.
 *
 * Usage:
 *   const data = await cachedApiCall(
 *     'shopify:products:all',
 *     () => fetch('https://iboltmounts.com/products.json').then(r => r.json()),
 *     { ttlMs: TTL.SHOPIFY_PRODUCTS, limiter: shopifyLimiter }
 *   );
 */
export async function cachedApiCall<T>(
  cacheKey: string,
  fetchFn: () => Promise<T>,
  opts: { ttlMs?: number; limiter?: RateLimiter; skipCache?: boolean } = {}
): Promise<T> {
  const { ttlMs = 300_000, limiter, skipCache = false } = opts;

  // Check cache first
  if (!skipCache) {
    const cached = cache.get<T>(cacheKey);
    if (cached !== null) return cached;
  }

  // Acquire rate limit token (waits if necessary)
  if (limiter) {
    await limiter.acquire();
  }

  // Execute the actual API call with retry on rate limit
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await fetchFn();
      // Cache the successful result
      if (!skipCache) {
        cache.set(cacheKey, result, ttlMs);
      }
      return result;
    } catch (err: unknown) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const status = (err as { status?: number }).status;
      // Retry on 429 (rate limited) with exponential backoff
      if (status === 429) {
        const backoff = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
        console.warn(`[apiCache] Rate limited on ${cacheKey}, retrying in ${Math.round(backoff)}ms (attempt ${attempt + 1}/3)`);
        await new Promise(r => setTimeout(r, backoff));
        continue;
      }
      // Don't retry other errors
      throw err;
    }
  }
  throw lastError;
}


/**
 * Get status of all rate limiters and cache.
 * Useful for monitoring and debugging.
 */
export function getSystemStatus() {
  return {
    cache: cache.getStats(),
    rateLimiters: {
      shopify: shopifyLimiter.getStatus(),
      anthropic: anthropicLimiter.getStatus(),
      openai: openaiLimiter.getStatus(),
      youtube: youtubeLimiter.getStatus(),
      reddit: redditLimiter.getStatus(),
    },
  };
}
