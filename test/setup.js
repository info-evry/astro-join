/**
 * Global test setup.
 * Clears the RATE_LIMIT KV namespace before every test so that unrelated
 * test suites making several requests to rate-limited endpoints never trip
 * the limiter.
 */
import { beforeEach } from 'vitest';
import { env } from 'cloudflare:test';

beforeEach(async () => {
  if (!env.RATE_LIMIT) return;
  const { keys } = await env.RATE_LIMIT.list();
  await Promise.all(keys.map((key) => env.RATE_LIMIT.delete(key.name)));
});
