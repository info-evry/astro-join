/**
 * Rate limiting module - re-exports from shared core library
 *
 * This file exists for backwards compatibility.
 * The canonical rate limiting implementation is in astro-core.
 */
export {
  createRateLimiter,
  checkRateLimit,
  getClientIp,
  pathPrefix,
  pathPattern
} from '../../core/src/lib/ratelimit.js';
