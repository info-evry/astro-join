/**
 * Rate limiting tests for the membership API
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';

beforeAll(async () => {
  await env.DB.exec(`CREATE TABLE IF NOT EXISTS members (id INTEGER PRIMARY KEY AUTOINCREMENT, first_name TEXT NOT NULL, last_name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, student_id TEXT, phone TEXT, telegram TEXT, discord TEXT, enrollment_track TEXT NOT NULL, enrollment_number TEXT, status TEXT NOT NULL DEFAULT 'pending', joined_at DATETIME DEFAULT CURRENT_TIMESTAMP, approved_at DATETIME, expires_at DATETIME, notes TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  await env.DB.exec(`CREATE TABLE IF NOT EXISTS membership_history (id INTEGER PRIMARY KEY AUTOINCREMENT, member_id INTEGER NOT NULL, old_status TEXT, new_status TEXT NOT NULL, changed_by TEXT, reason TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  await env.DB.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
});

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
