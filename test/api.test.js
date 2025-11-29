/**
 * API Tests for Membership System
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';

// Initialize database schema before tests
beforeAll(async () => {
  await env.DB.exec(`CREATE TABLE IF NOT EXISTS members (id INTEGER PRIMARY KEY AUTOINCREMENT, first_name TEXT NOT NULL, last_name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, student_id TEXT, phone TEXT, telegram TEXT, discord TEXT, enrollment_track TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', joined_at DATETIME DEFAULT CURRENT_TIMESTAMP, approved_at DATETIME, expires_at DATETIME, notes TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  await env.DB.exec(`CREATE TABLE IF NOT EXISTS membership_history (id INTEGER PRIMARY KEY AUTOINCREMENT, member_id INTEGER NOT NULL, old_status TEXT, new_status TEXT NOT NULL, changed_by TEXT, reason TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  await env.DB.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  await env.DB.exec(`INSERT OR IGNORE INTO settings (key, value) VALUES ('membership_open', 'true')`);
  await env.DB.exec(`INSERT OR IGNORE INTO settings (key, value) VALUES ('current_year', '2024-2025')`);
});

// Clean up members table before each test
beforeEach(async () => {
  await env.DB.exec('DELETE FROM members');
  await env.DB.exec('DELETE FROM membership_history');
});

describe('Public API', () => {
  describe('GET /api/config', () => {
    it('should return configuration', async () => {
      const response = await SELF.fetch('http://localhost/api/config');
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.config).toBeDefined();
      expect(data.config.membershipOpen).toBe(true);
      expect(data.config.currentYear).toBe('2024-2025');
    });
  });

  describe('GET /api/stats', () => {
    it('should return stats', async () => {
      const response = await SELF.fetch('http://localhost/api/stats');
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.stats).toBeDefined();
      expect(data.stats.activeMembers).toBe(0);
      expect(data.stats.pendingApplications).toBe(0);
    });
  });

  describe('POST /api/apply', () => {
    it('should create a new application', async () => {
      const response = await SELF.fetch('http://localhost/api/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: 'John',
          lastName: 'Doe',
          email: 'john.doe@test.com',
          enrollmentTrack: 'L3 Informatique',
          discord: 'johndoe#1234'
        })
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.memberId).toBeDefined();

      // Verify in database
      const member = await env.DB.prepare(
        'SELECT * FROM members WHERE email = ?'
      ).bind('john.doe@test.com').first();

      expect(member).toBeDefined();
      expect(member.first_name).toBe('John');
      expect(member.last_name).toBe('Doe');
      expect(member.status).toBe('pending');
    });

    it('should reject application without contact method', async () => {
      const response = await SELF.fetch('http://localhost/api/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: 'John',
          lastName: 'Doe',
          email: 'john.doe@test.com',
          enrollmentTrack: 'L3 Informatique'
        })
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('contact');
    });

    it('should reject duplicate email', async () => {
      // First application
      await SELF.fetch('http://localhost/api/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: 'John',
          lastName: 'Doe',
          email: 'duplicate@test.com',
          enrollmentTrack: 'L3 Informatique',
          telegram: '@johndoe'
        })
      });

      // Duplicate application
      const response = await SELF.fetch('http://localhost/api/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: 'Jane',
          lastName: 'Doe',
          email: 'duplicate@test.com',
          enrollmentTrack: 'M1 Informatique',
          telegram: '@janedoe'
        })
      });

      expect(response.status).toBe(409);
    });

    it('should reject missing required fields', async () => {
      const response = await SELF.fetch('http://localhost/api/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: 'John'
        })
      });

      expect(response.status).toBe(400);
    });
  });
});

describe('Admin API', () => {
  const adminHeaders = {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer test-admin-token'
  };

  describe('Authentication', () => {
    it('should reject requests without token', async () => {
      const response = await SELF.fetch('http://localhost/api/admin/members');
      expect(response.status).toBe(401);
    });

    it('should reject requests with invalid token', async () => {
      const response = await SELF.fetch('http://localhost/api/admin/members', {
        headers: { 'Authorization': 'Bearer invalid-token' }
      });
      expect(response.status).toBe(401);
    });

    it('should accept requests with valid token', async () => {
      const response = await SELF.fetch('http://localhost/api/admin/members', {
        headers: adminHeaders
      });
      expect(response.status).toBe(200);
    });
  });

  describe('GET /api/admin/members', () => {
    it('should return all members with stats', async () => {
      // Add test member
      await env.DB.prepare(`
        INSERT INTO members (first_name, last_name, email, enrollment_track, status, discord)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind('Test', 'User', 'test@example.com', 'L3 Informatique', 'active', '@test').run();

      const response = await SELF.fetch('http://localhost/api/admin/members', {
        headers: adminHeaders
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.members).toHaveLength(1);
      expect(data.stats.total).toBe(1);
      expect(data.stats.active).toBe(1);
    });
  });

  describe('PUT /api/admin/members/:id', () => {
    it('should update member status', async () => {
      // Add pending member
      const result = await env.DB.prepare(`
        INSERT INTO members (first_name, last_name, email, enrollment_track, status, discord)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind('Test', 'User', 'test@example.com', 'L3 Informatique', 'pending', '@test').run();

      const memberId = result.meta.last_row_id;

      const response = await SELF.fetch(`http://localhost/api/admin/members/${memberId}`, {
        method: 'PUT',
        headers: adminHeaders,
        body: JSON.stringify({ status: 'active' })
      });

      expect(response.status).toBe(200);

      // Verify update
      const member = await env.DB.prepare(
        'SELECT * FROM members WHERE id = ?'
      ).bind(memberId).first();

      expect(member.status).toBe('active');
      expect(member.approved_at).toBeDefined();
    });

    it('should update member details', async () => {
      const result = await env.DB.prepare(`
        INSERT INTO members (first_name, last_name, email, enrollment_track, status, discord)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind('Test', 'User', 'test@example.com', 'L3 Informatique', 'pending', '@test').run();

      const memberId = result.meta.last_row_id;

      const response = await SELF.fetch(`http://localhost/api/admin/members/${memberId}`, {
        method: 'PUT',
        headers: adminHeaders,
        body: JSON.stringify({
          firstName: 'Updated',
          lastName: 'Name',
          notes: 'Test notes'
        })
      });

      expect(response.status).toBe(200);

      const member = await env.DB.prepare(
        'SELECT * FROM members WHERE id = ?'
      ).bind(memberId).first();

      expect(member.first_name).toBe('Updated');
      expect(member.last_name).toBe('Name');
      expect(member.notes).toBe('Test notes');
    });
  });

  describe('DELETE /api/admin/members/:id', () => {
    it('should delete member', async () => {
      const result = await env.DB.prepare(`
        INSERT INTO members (first_name, last_name, email, enrollment_track, status, discord)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind('Test', 'User', 'delete@example.com', 'L3 Informatique', 'pending', '@test').run();

      const memberId = result.meta.last_row_id;

      const response = await SELF.fetch(`http://localhost/api/admin/members/${memberId}`, {
        method: 'DELETE',
        headers: adminHeaders
      });

      expect(response.status).toBe(200);

      const member = await env.DB.prepare(
        'SELECT * FROM members WHERE id = ?'
      ).bind(memberId).first();

      expect(member).toBeNull();
    });

    it('should return 404 for non-existent member', async () => {
      const response = await SELF.fetch('http://localhost/api/admin/members/99999', {
        method: 'DELETE',
        headers: adminHeaders
      });

      expect(response.status).toBe(404);
    });
  });

  describe('POST /api/admin/members/batch', () => {
    it('should batch update member statuses', async () => {
      // Add multiple pending members
      await env.DB.exec(`INSERT INTO members (first_name, last_name, email, enrollment_track, status, discord) VALUES ('User1', 'Test', 'user1@example.com', 'L3 Informatique', 'pending', '@user1')`);
      await env.DB.exec(`INSERT INTO members (first_name, last_name, email, enrollment_track, status, discord) VALUES ('User2', 'Test', 'user2@example.com', 'L3 Informatique', 'pending', '@user2')`);
      await env.DB.exec(`INSERT INTO members (first_name, last_name, email, enrollment_track, status, discord) VALUES ('User3', 'Test', 'user3@example.com', 'L3 Informatique', 'pending', '@user3')`);

      const members = await env.DB.prepare('SELECT id FROM members').all();
      const memberIds = members.results.map(m => m.id);

      const response = await SELF.fetch('http://localhost/api/admin/members/batch', {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          memberIds,
          status: 'active',
          reason: 'Batch test'
        })
      });

      expect(response.status).toBe(200);

      // Verify all are active
      const updated = await env.DB.prepare(
        "SELECT COUNT(*) as count FROM members WHERE status = 'active'"
      ).first();

      expect(updated.count).toBe(3);
    });
  });

  describe('GET /api/admin/export', () => {
    it('should export members as CSV', async () => {
      await env.DB.prepare(`
        INSERT INTO members (first_name, last_name, email, enrollment_track, status, discord)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind('Test', 'User', 'export@example.com', 'L3 Informatique', 'active', '@test').run();

      const response = await SELF.fetch('http://localhost/api/admin/export', {
        headers: adminHeaders
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toContain('text/csv');

      const csv = await response.text();
      expect(csv).toContain('Test');
      expect(csv).toContain('export@example.com');
    });

    it('should filter export by status', async () => {
      await env.DB.exec(`INSERT INTO members (first_name, last_name, email, enrollment_track, status, discord) VALUES ('Active', 'User', 'active@example.com', 'L3 Informatique', 'active', '@active')`);
      await env.DB.exec(`INSERT INTO members (first_name, last_name, email, enrollment_track, status, discord) VALUES ('Pending', 'User', 'pending@example.com', 'L3 Informatique', 'pending', '@pending')`);

      const response = await SELF.fetch('http://localhost/api/admin/export?status=active', {
        headers: adminHeaders
      });

      const csv = await response.text();
      expect(csv).toContain('active@example.com');
      expect(csv).not.toContain('pending@example.com');
    });
  });

  describe('Settings', () => {
    it('should get settings', async () => {
      const response = await SELF.fetch('http://localhost/api/admin/settings', {
        headers: adminHeaders
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.settings.membership_open).toBe(true);
    });

    it('should update settings', async () => {
      const response = await SELF.fetch('http://localhost/api/admin/settings', {
        method: 'PUT',
        headers: adminHeaders,
        body: JSON.stringify({
          membership_open: 'false',
          current_year: '2025-2026'
        })
      });

      expect(response.status).toBe(200);

      // Verify update
      const settings = await env.DB.prepare(
        "SELECT value FROM settings WHERE key = 'current_year'"
      ).first();

      expect(settings.value).toBe('2025-2026');
    });
  });
});
