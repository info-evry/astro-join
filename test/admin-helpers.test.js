/**
 * Admin Helper Function Tests
 * Tests for extracted helper functions in admin.js
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';

beforeAll(async () => {
  await env.DB.exec(`CREATE TABLE IF NOT EXISTS members (id INTEGER PRIMARY KEY AUTOINCREMENT, first_name TEXT NOT NULL, last_name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, phone TEXT, student_id TEXT, enrollment_number TEXT, enrollment_track TEXT DEFAULT 'Autre', status TEXT DEFAULT 'pending', telegram TEXT, discord TEXT, notes TEXT, approved_at TEXT, expires_at TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))`);
  await env.DB.exec(`CREATE TABLE IF NOT EXISTS membership_history (id INTEGER PRIMARY KEY AUTOINCREMENT, member_id INTEGER NOT NULL, old_status TEXT, new_status TEXT NOT NULL, reason TEXT, created_at TEXT DEFAULT (datetime('now')))`);
});

describe('CSV Import - Header Parsing', () => {
  it('should parse French headers correctly', async () => {
    const csvData = 'Prénom,Nom,Email\nJean,Dupont,jean@example.com';

    const response = await SELF.fetch('http://localhost/api/admin/import', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test-admin-token'
      },
      body: JSON.stringify({ csv: csvData })
    });

    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.stats.imported).toBe(1);
  });

  it('should parse English headers correctly', async () => {
    const csvData = 'firstname,lastname,email\nJohn,Smith,john@example.com';

    const response = await SELF.fetch('http://localhost/api/admin/import', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test-admin-token'
      },
      body: JSON.stringify({ csv: csvData })
    });

    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.stats.imported).toBe(1);
  });

  it('should reject CSV without required headers', async () => {
    const csvData = 'Name,Contact\nJohn Smith,john@example.com';

    const response = await SELF.fetch('http://localhost/api/admin/import', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test-admin-token'
      },
      body: JSON.stringify({ csv: csvData })
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('Prénom');
  });
});

describe('CSV Import - Row Validation', () => {
  it('should skip rows with invalid email', async () => {
    const csvData = 'Prénom,Nom,Email\nValid,User,valid@example.com\nInvalid,User,notanemail';

    const response = await SELF.fetch('http://localhost/api/admin/import', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test-admin-token'
      },
      body: JSON.stringify({ csv: csvData })
    });

    const data = await response.json();
    expect(data.stats.imported).toBe(1);
    expect(data.stats.skipped).toBe(1);
    expect(data.errors.some(e => e.includes('Invalid email'))).toBe(true);
  });

  it('should skip rows with missing required fields', async () => {
    const csvData = 'Prénom,Nom,Email\n,Missing,missing@example.com\nAlsoMissing,,also@example.com';

    const response = await SELF.fetch('http://localhost/api/admin/import', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test-admin-token'
      },
      body: JSON.stringify({ csv: csvData })
    });

    const data = await response.json();
    expect(data.stats.skipped).toBe(2);
  });
});

describe('Member Update - Field Mapping', () => {
  let memberId;

  beforeAll(async () => {
    const result = await env.DB.prepare(
      'INSERT INTO members (first_name, last_name, email, status) VALUES (?, ?, ?, ?)'
    ).bind('Update', 'Test', 'update-test@example.com', 'pending').run();
    memberId = result.meta.last_row_id;
  });

  it('should update basic fields', async () => {
    const response = await SELF.fetch(`http://localhost/api/admin/members/${memberId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test-admin-token'
      },
      body: JSON.stringify({
        firstName: 'Updated',
        lastName: 'Name',
        email: 'updated@example.com'
      })
    });

    expect(response.status).toBe(200);

    const member = await env.DB.prepare('SELECT * FROM members WHERE id = ?').bind(memberId).first();
    expect(member.first_name).toBe('Updated');
    expect(member.last_name).toBe('Name');
    expect(member.email).toBe('updated@example.com');
  });

  it('should update optional fields', async () => {
    const response = await SELF.fetch(`http://localhost/api/admin/members/${memberId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test-admin-token'
      },
      body: JSON.stringify({
        phone: '0612345678',
        studentId: 'STU123',
        telegram: '@telegram',
        discord: 'user#1234'
      })
    });

    expect(response.status).toBe(200);

    const member = await env.DB.prepare('SELECT * FROM members WHERE id = ?').bind(memberId).first();
    expect(member.phone).toBe('0612345678');
    expect(member.student_id).toBe('STU123');
    expect(member.telegram).toBe('@telegram');
    expect(member.discord).toBe('user#1234');
  });
});

describe('Member Update - Status Changes', () => {
  it('should reject invalid status', async () => {
    const result = await env.DB.prepare(
      'INSERT INTO members (first_name, last_name, email, status) VALUES (?, ?, ?, ?)'
    ).bind('Status', 'Test', 'status-test@example.com', 'pending').run();

    const response = await SELF.fetch(`http://localhost/api/admin/members/${result.meta.last_row_id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test-admin-token'
      },
      body: JSON.stringify({
        status: 'invalid_status'
      })
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('Invalid status');
  });

  it('should set approval dates when activating member', async () => {
    const result = await env.DB.prepare(
      'INSERT INTO members (first_name, last_name, email, status) VALUES (?, ?, ?, ?)'
    ).bind('Activate', 'Test', 'activate-test@example.com', 'pending').run();

    const response = await SELF.fetch(`http://localhost/api/admin/members/${result.meta.last_row_id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test-admin-token'
      },
      body: JSON.stringify({
        status: 'active'
      })
    });

    expect(response.status).toBe(200);

    const member = await env.DB.prepare('SELECT * FROM members WHERE id = ?')
      .bind(result.meta.last_row_id).first();
    expect(member.status).toBe('active');
    expect(member.approved_at).not.toBeNull();
    expect(member.expires_at).not.toBeNull();
  });

  it('should log status changes in history', async () => {
    const result = await env.DB.prepare(
      'INSERT INTO members (first_name, last_name, email, status) VALUES (?, ?, ?, ?)'
    ).bind('History', 'Test', 'history-test@example.com', 'pending').run();

    await SELF.fetch(`http://localhost/api/admin/members/${result.meta.last_row_id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test-admin-token'
      },
      body: JSON.stringify({
        status: 'active',
        reason: 'Approved via test'
      })
    });

    const history = await env.DB.prepare(
      'SELECT * FROM membership_history WHERE member_id = ?'
    ).bind(result.meta.last_row_id).first();

    expect(history).not.toBeNull();
    expect(history.old_status).toBe('pending');
    expect(history.new_status).toBe('active');
    expect(history.reason).toBe('Approved via test');
  });
});
