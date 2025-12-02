/**
 * API Tests for Membership System
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';

// Initialize database schema before tests
beforeAll(async () => {
  await env.DB.exec(`CREATE TABLE IF NOT EXISTS members (id INTEGER PRIMARY KEY AUTOINCREMENT, first_name TEXT NOT NULL, last_name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, student_id TEXT, phone TEXT, telegram TEXT, discord TEXT, enrollment_track TEXT NOT NULL, enrollment_number TEXT, status TEXT NOT NULL DEFAULT 'pending', joined_at DATETIME DEFAULT CURRENT_TIMESTAMP, approved_at DATETIME, expires_at DATETIME, notes TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
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

    it('should return enrollment tracks', async () => {
      const response = await SELF.fetch('http://localhost/api/config');
      const data = await response.json();
      expect(data.config.enrollmentTracks).toBeDefined();
      expect(Array.isArray(data.config.enrollmentTracks)).toBe(true);
      expect(data.config.enrollmentTracks).toContain('L3 Informatique');
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

    it('should count active and pending members correctly', async () => {
      // Add active member
      await env.DB.exec(`INSERT INTO members (first_name, last_name, email, enrollment_track, status, discord) VALUES ('Active', 'User', 'active@test.com', 'L3 Informatique', 'active', '@active')`);
      // Add pending member
      await env.DB.exec(`INSERT INTO members (first_name, last_name, email, enrollment_track, status, discord) VALUES ('Pending', 'User', 'pending@test.com', 'L3 Informatique', 'pending', '@pending')`);

      const response = await SELF.fetch('http://localhost/api/stats');
      const data = await response.json();
      expect(data.stats.activeMembers).toBe(1);
      expect(data.stats.pendingApplications).toBe(1);
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

    it('should record membership history on application', async () => {
      const response = await SELF.fetch('http://localhost/api/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: 'History',
          lastName: 'Test',
          email: 'history@test.com',
          enrollmentTrack: 'L3 Informatique',
          phone: '0612345678'
        })
      });

      const data = await response.json();
      const history = await env.DB.prepare(
        'SELECT * FROM membership_history WHERE member_id = ?'
      ).bind(data.memberId).first();

      expect(history).toBeDefined();
      expect(history.new_status).toBe('pending');
      expect(history.reason).toContain('Application');
    });

    it('should accept application with phone only', async () => {
      const response = await SELF.fetch('http://localhost/api/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: 'Phone',
          lastName: 'Only',
          email: 'phone@test.com',
          enrollmentTrack: 'L3 Informatique',
          phone: '0612345678'
        })
      });

      expect(response.status).toBe(200);
    });

    it('should accept application with telegram only', async () => {
      const response = await SELF.fetch('http://localhost/api/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: 'Telegram',
          lastName: 'Only',
          email: 'telegram@test.com',
          enrollmentTrack: 'L3 Informatique',
          telegram: '@telegramuser'
        })
      });

      expect(response.status).toBe(200);
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

    it('should reject duplicate email for pending application', async () => {
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
      const data = await response.json();
      expect(data.error).toContain('attente');
    });

    it('should reject duplicate email for active member', async () => {
      // Create active member directly
      await env.DB.exec(`INSERT INTO members (first_name, last_name, email, enrollment_track, status, discord) VALUES ('Active', 'Member', 'active@test.com', 'L3 Informatique', 'active', '@active')`);

      // Try to apply with same email
      const response = await SELF.fetch('http://localhost/api/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: 'New',
          lastName: 'User',
          email: 'active@test.com',
          enrollmentTrack: 'M1 Informatique',
          telegram: '@newuser'
        })
      });

      expect(response.status).toBe(409);
      const data = await response.json();
      expect(data.error).toContain('actif');
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

    it('should reject invalid email format', async () => {
      const response = await SELF.fetch('http://localhost/api/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: 'John',
          lastName: 'Doe',
          email: 'invalid-email',
          enrollmentTrack: 'L3 Informatique',
          discord: '@johndoe'
        })
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('invalide');
    });

    it('should normalize email to lowercase', async () => {
      const response = await SELF.fetch('http://localhost/api/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: 'Upper',
          lastName: 'Case',
          email: 'UPPER.CASE@TEST.COM',
          enrollmentTrack: 'L3 Informatique',
          discord: '@upper'
        })
      });

      expect(response.status).toBe(200);

      const member = await env.DB.prepare(
        'SELECT email FROM members WHERE email = ?'
      ).bind('upper.case@test.com').first();

      expect(member).toBeDefined();
    });

    it('should trim whitespace from fields', async () => {
      const response = await SELF.fetch('http://localhost/api/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: '  John  ',
          lastName: '  Doe  ',
          email: 'trim@test.com',
          enrollmentTrack: 'L3 Informatique',
          discord: '  @johndoe  '
        })
      });

      expect(response.status).toBe(200);

      const member = await env.DB.prepare(
        'SELECT * FROM members WHERE email = ?'
      ).bind('trim@test.com').first();

      expect(member.first_name).toBe('John');
      expect(member.last_name).toBe('Doe');
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

    it('should reject requests with malformed Authorization header', async () => {
      const response = await SELF.fetch('http://localhost/api/admin/members', {
        headers: { 'Authorization': 'InvalidFormat' }
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

    it('should return empty list when no members', async () => {
      const response = await SELF.fetch('http://localhost/api/admin/members', {
        headers: adminHeaders
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.members).toHaveLength(0);
      expect(data.stats.total).toBe(0);
    });
  });

  describe('GET /api/admin/stats', () => {
    it('should return comprehensive admin stats', async () => {
      // Add members with different statuses and tracks
      await env.DB.exec(`INSERT INTO members (first_name, last_name, email, enrollment_track, status, discord) VALUES ('L3', 'Active', 'l3active@test.com', 'L3 Informatique', 'active', '@l3')`);
      await env.DB.exec(`INSERT INTO members (first_name, last_name, email, enrollment_track, status, discord) VALUES ('M1', 'Active', 'm1active@test.com', 'M1 Informatique', 'active', '@m1')`);
      await env.DB.exec(`INSERT INTO members (first_name, last_name, email, enrollment_track, status, discord) VALUES ('Pending', 'User', 'pending@test.com', 'L3 Informatique', 'pending', '@pending')`);

      const response = await SELF.fetch('http://localhost/api/admin/stats', {
        headers: adminHeaders
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.stats.total).toBe(3);
      expect(data.stats.active).toBe(2);
      expect(data.stats.pending).toBe(1);
      expect(data.trackDistribution).toBeDefined();
      expect(data.recentApplications).toBeDefined();
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

    it('should set expires_at when approving member', async () => {
      const result = await env.DB.prepare(`
        INSERT INTO members (first_name, last_name, email, enrollment_track, status, discord)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind('Expiry', 'Test', 'expiry@example.com', 'L3 Informatique', 'pending', '@expiry').run();

      const memberId = result.meta.last_row_id;

      await SELF.fetch(`http://localhost/api/admin/members/${memberId}`, {
        method: 'PUT',
        headers: adminHeaders,
        body: JSON.stringify({ status: 'active' })
      });

      const member = await env.DB.prepare(
        'SELECT expires_at FROM members WHERE id = ?'
      ).bind(memberId).first();

      expect(member.expires_at).toBeDefined();
      expect(member.expires_at).toContain('-08-31');
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

    it('should return 404 for non-existent member', async () => {
      const response = await SELF.fetch('http://localhost/api/admin/members/99999', {
        method: 'PUT',
        headers: adminHeaders,
        body: JSON.stringify({ status: 'active' })
      });

      expect(response.status).toBe(404);
    });

    it('should record status change in history', async () => {
      const result = await env.DB.prepare(`
        INSERT INTO members (first_name, last_name, email, enrollment_track, status, discord)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind('History', 'Test', 'history@example.com', 'L3 Informatique', 'pending', '@history').run();

      const memberId = result.meta.last_row_id;

      await SELF.fetch(`http://localhost/api/admin/members/${memberId}`, {
        method: 'PUT',
        headers: adminHeaders,
        body: JSON.stringify({ status: 'active', reason: 'Approved by admin' })
      });

      const history = await env.DB.prepare(
        'SELECT * FROM membership_history WHERE member_id = ? ORDER BY id DESC LIMIT 1'
      ).bind(memberId).first();

      expect(history.old_status).toBe('pending');
      expect(history.new_status).toBe('active');
      expect(history.reason).toBe('Approved by admin');
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

    it('should reject empty memberIds array', async () => {
      const response = await SELF.fetch('http://localhost/api/admin/members/batch', {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          memberIds: [],
          status: 'active'
        })
      });

      expect(response.status).toBe(400);
    });

    it('should reject invalid status', async () => {
      await env.DB.exec(`INSERT INTO members (first_name, last_name, email, enrollment_track, status, discord) VALUES ('Test', 'User', 'test@example.com', 'L3 Informatique', 'pending', '@test')`);

      const members = await env.DB.prepare('SELECT id FROM members').all();
      const memberIds = members.results.map(m => m.id);

      const response = await SELF.fetch('http://localhost/api/admin/members/batch', {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          memberIds,
          status: 'invalid_status'
        })
      });

      expect(response.status).toBe(400);
    });

    it('should batch reject members', async () => {
      await env.DB.exec(`INSERT INTO members (first_name, last_name, email, enrollment_track, status, discord) VALUES ('Reject1', 'Test', 'reject1@example.com', 'L3 Informatique', 'pending', '@r1')`);
      await env.DB.exec(`INSERT INTO members (first_name, last_name, email, enrollment_track, status, discord) VALUES ('Reject2', 'Test', 'reject2@example.com', 'L3 Informatique', 'pending', '@r2')`);

      const members = await env.DB.prepare('SELECT id FROM members').all();
      const memberIds = members.results.map(m => m.id);

      const response = await SELF.fetch('http://localhost/api/admin/members/batch', {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          memberIds,
          status: 'rejected',
          reason: 'Test rejection'
        })
      });

      expect(response.status).toBe(200);

      const rejected = await env.DB.prepare(
        "SELECT COUNT(*) as count FROM members WHERE status = 'rejected'"
      ).first();

      expect(rejected.count).toBe(2);
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

    it('should have proper CSV headers', async () => {
      await env.DB.exec(`INSERT INTO members (first_name, last_name, email, enrollment_track, status, discord) VALUES ('Test', 'User', 'test@example.com', 'L3 Informatique', 'active', '@test')`);

      const response = await SELF.fetch('http://localhost/api/admin/export', {
        headers: adminHeaders
      });

      const csv = await response.text();
      expect(csv).toContain('Prénom');
      expect(csv).toContain('Nom');
      expect(csv).toContain('Email');
      expect(csv).toContain('Statut');
    });

    it('should escape special characters in CSV', async () => {
      await env.DB.prepare(`
        INSERT INTO members (first_name, last_name, email, enrollment_track, status, notes, discord)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind('Test', 'User"Quote', 'special@example.com', 'L3 Informatique', 'active', 'Note with "quotes"', '@test').run();

      const response = await SELF.fetch('http://localhost/api/admin/export', {
        headers: adminHeaders
      });

      expect(response.status).toBe(200);
      const csv = await response.text();
      expect(csv).toContain('""');
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

    it('should handle object settings (JSON)', async () => {
      const tracks = ['L1', 'L2', 'L3', 'M1', 'M2'];

      const response = await SELF.fetch('http://localhost/api/admin/settings', {
        method: 'PUT',
        headers: adminHeaders,
        body: JSON.stringify({
          enrollment_tracks: tracks
        })
      });

      expect(response.status).toBe(200);

      const getResponse = await SELF.fetch('http://localhost/api/admin/settings', {
        headers: adminHeaders
      });

      const data = await getResponse.json();
      expect(data.settings.enrollment_tracks).toEqual(tracks);
    });
  });

  describe('Bureau Status Management', () => {
    it('should allow setting bureau status', async () => {
      // Create member
      await env.DB.prepare(`
        INSERT INTO members (first_name, last_name, email, enrollment_track, status, discord)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind('Bureau', 'Member', 'bureau@test.com', 'L3 Informatique', 'active', '@bureau').run();

      const member = await env.DB.prepare('SELECT id FROM members WHERE email = ?').bind('bureau@test.com').first();

      const response = await SELF.fetch(`http://localhost/api/admin/members/${member.id}`, {
        method: 'PUT',
        headers: adminHeaders,
        body: JSON.stringify({ status: 'president' })
      });

      expect(response.status).toBe(200);

      const updated = await env.DB.prepare('SELECT status FROM members WHERE id = ?').bind(member.id).first();
      expect(updated.status).toBe('president');
    });

    it('should reject duplicate bureau position', async () => {
      // Create president
      await env.DB.prepare(`
        INSERT INTO members (first_name, last_name, email, enrollment_track, status, discord)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind('Current', 'President', 'president@test.com', 'L3 Informatique', 'president', '@president').run();

      // Create another member
      await env.DB.prepare(`
        INSERT INTO members (first_name, last_name, email, enrollment_track, status, discord)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind('Other', 'Member', 'other@test.com', 'L3 Informatique', 'active', '@other').run();

      const other = await env.DB.prepare('SELECT id FROM members WHERE email = ?').bind('other@test.com').first();

      const response = await SELF.fetch(`http://localhost/api/admin/members/${other.id}`, {
        method: 'PUT',
        headers: adminHeaders,
        body: JSON.stringify({ status: 'president' })
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Président');
    });

    it('should allow changing own bureau position', async () => {
      // Create president
      await env.DB.prepare(`
        INSERT INTO members (first_name, last_name, email, enrollment_track, status, discord)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind('Current', 'President', 'president@test.com', 'L3 Informatique', 'president', '@president').run();

      const member = await env.DB.prepare('SELECT id FROM members WHERE email = ?').bind('president@test.com').first();

      // Change to vice_president (should work since president position is now free)
      const response = await SELF.fetch(`http://localhost/api/admin/members/${member.id}`, {
        method: 'PUT',
        headers: adminHeaders,
        body: JSON.stringify({ status: 'vice_president' })
      });

      expect(response.status).toBe(200);
    });

    it('should reject invalid status', async () => {
      await env.DB.prepare(`
        INSERT INTO members (first_name, last_name, email, enrollment_track, status, discord)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind('Test', 'User', 'test@test.com', 'L3 Informatique', 'active', '@test').run();

      const member = await env.DB.prepare('SELECT id FROM members WHERE email = ?').bind('test@test.com').first();

      const response = await SELF.fetch(`http://localhost/api/admin/members/${member.id}`, {
        method: 'PUT',
        headers: adminHeaders,
        body: JSON.stringify({ status: 'invalid_status' })
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Invalid status');
    });
  });

  describe('POST /api/admin/import', () => {
    it('should require authorization', async () => {
      const response = await SELF.fetch('http://localhost/api/admin/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv: 'Prénom,Nom,Email\nJohn,Doe,john@test.com' })
      });
      expect(response.status).toBe(401);
    });

    it('should import members from CSV', async () => {
      const csv = `Prénom,Nom,Email,Téléphone,Filière d'inscription,Statut
John,Doe,john@test.com,0612345678,L3 Informatique,Membre actif
Jane,Smith,jane@test.com,0687654321,M1 Informatique,Membre actif`;

      const response = await SELF.fetch('http://localhost/api/admin/import', {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ csv })
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.stats.imported).toBe(2);
      expect(data.stats.skipped).toBe(0);

      // Verify members were created
      const members = await env.DB.prepare('SELECT * FROM members ORDER BY email').all();
      expect(members.results).toHaveLength(2);
      expect(members.results[0].email).toBe('jane@test.com');
      expect(members.results[1].email).toBe('john@test.com');
    });

    it('should update existing members on import', async () => {
      // Create existing member
      await env.DB.prepare(`
        INSERT INTO members (first_name, last_name, email, enrollment_track, status, discord)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind('Old', 'Name', 'john@test.com', 'L1 Informatique', 'pending', '@old').run();

      const csv = `Prénom,Nom,Email,Filière d'inscription,Statut
John,Doe,john@test.com,L3 Informatique,Membre actif`;

      const response = await SELF.fetch('http://localhost/api/admin/import', {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ csv })
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.stats.imported).toBe(0);
      expect(data.stats.updated).toBe(1);

      // Verify member was updated
      const member = await env.DB.prepare('SELECT * FROM members WHERE email = ?').bind('john@test.com').first();
      expect(member.first_name).toBe('John');
      expect(member.last_name).toBe('Doe');
      expect(member.status).toBe('active');
    });

    it('should reject duplicate bureau positions in import', async () => {
      // Create existing president
      await env.DB.prepare(`
        INSERT INTO members (first_name, last_name, email, enrollment_track, status, discord)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind('Current', 'President', 'president@test.com', 'L3 Informatique', 'president', '@president').run();

      const csv = `Prénom,Nom,Email,Statut
New,President,new@test.com,Président`;

      const response = await SELF.fetch('http://localhost/api/admin/import', {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ csv })
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.stats.skipped).toBe(1);
      expect(data.errors).toBeDefined();
      expect(data.errors[0]).toContain('Président');
    });

    it('should require CSV data', async () => {
      const response = await SELF.fetch('http://localhost/api/admin/import', {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({})
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('required');
    });

    it('should require header row and data', async () => {
      const response = await SELF.fetch('http://localhost/api/admin/import', {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ csv: 'Prénom,Nom,Email' })
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('header');
    });

    it('should validate required columns', async () => {
      const response = await SELF.fetch('http://localhost/api/admin/import', {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ csv: 'Name,Status\nJohn,Active' })
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Prénom');
    });

    it('should skip rows with invalid email', async () => {
      const csv = `Prénom,Nom,Email
John,Doe,invalid-email
Jane,Smith,jane@test.com`;

      const response = await SELF.fetch('http://localhost/api/admin/import', {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ csv })
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.stats.imported).toBe(1);
      expect(data.stats.skipped).toBe(1);
    });

    it('should handle tab-separated values', async () => {
      const csv = `Prénom\tNom\tEmail
John\tDoe\tjohn@test.com`;

      const response = await SELF.fetch('http://localhost/api/admin/import', {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ csv })
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.stats.imported).toBe(1);
    });

    it('should map French status labels correctly', async () => {
      const csv = `Prénom,Nom,Email,Statut
Alice,Admin,alice@test.com,Secrétaire
Bob,Boss,bob@test.com,Trésorier`;

      const response = await SELF.fetch('http://localhost/api/admin/import', {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ csv })
      });

      expect(response.status).toBe(200);

      const alice = await env.DB.prepare('SELECT status FROM members WHERE email = ?').bind('alice@test.com').first();
      const bob = await env.DB.prepare('SELECT status FROM members WHERE email = ?').bind('bob@test.com').first();

      expect(alice.status).toBe('secretary');
      expect(bob.status).toBe('treasurer');
    });
  });
});
