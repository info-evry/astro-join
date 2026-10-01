/**
 * Rate limiting tests for the membership API
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { SELF } from 'cloudflare:test';
import { setupSchema } from './helpers.js';

beforeAll(setupSchema);

function applyRequest(ip, index) {
  return SELF.fetch('http://localhost/api/apply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
    body: JSON.stringify({
      firstName: 'Rate',
      lastName: `Limit${index}`,
      email: `ratelimit${index}@test.com`,
      enrollmentTrack: 'L3 Informatique',
      discord: `@ratelimit${index}`
    })
  });
}

describe('POST /api/apply rate limiting', () => {
  it('allows 5 requests from the same IP and blocks the 6th with 429', async () => {
    const ip = '203.0.113.42';

    for (let i = 0; i < 5; i++) {
      const response = await applyRequest(ip, i);
      expect(response.status).toBe(200);
    }

    const blocked = await applyRequest(ip, 5);
    expect(blocked.status).toBe(429);
    const data = await blocked.json();
    expect(data.error).toBeDefined();
  });
});
