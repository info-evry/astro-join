/**
 * Shared helpers for worker-side API tests.
 *
 * The schema is loaded from the real db/schema.sql (not a hand-rolled copy) so
 * foreign keys, indexes and the enrollment_number column behave exactly like
 * production.
 */
import { env, SELF } from 'cloudflare:test';
import schemaSql from '../db/schema.sql?raw';

export const BASE = 'http://localhost';
export const ADMIN_TOKEN = 'test-admin-token';

export const adminHeaders = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${ADMIN_TOKEN}`
};

/** Split a .sql file into single-line statements (D1 exec is line oriented). */
function toStatements(sql) {
  return sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((statement) => statement.replaceAll(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/** Create the production schema (idempotent per test file). */
export async function setupSchema() {
  for (const statement of toStatements(schemaSql)) {
    await env.DB.prepare(statement).run();
  }
}

/** Remove all members/history (settings are left alone). */
export async function resetMembers() {
  await env.DB.prepare('DELETE FROM membership_history').run();
  await env.DB.prepare('DELETE FROM members').run();
}

let counter = 0;
/** Unique token for fixtures so tests never collide on UNIQUE columns. */
export function uid(prefix = 'u') {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}${counter}`;
}

/** Insert a member row directly; returns its id. */
export async function insertMember(overrides = {}) {
  const key = uid('m');
  const row = {
    first_name: 'First',
    last_name: 'Last',
    email: `${key}@test.example`,
    enrollment_track: 'L3 Informatique',
    status: 'pending',
    discord: '@fixture',
    ...overrides
  };
  const columns = Object.keys(row);
  const result = await env.DB.prepare(
    `INSERT INTO members (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`
  ).bind(...columns.map((column) => row[column])).run();
  return result.meta.last_row_id;
}

export async function getMember(id) {
  return env.DB.prepare('SELECT * FROM members WHERE id = ?').bind(id).first();
}

export async function getHistory(memberId) {
  const { results } = await env.DB.prepare(
    'SELECT * FROM membership_history WHERE member_id = ? ORDER BY id'
  ).bind(memberId).all();
  return results;
}

/** Authenticated admin request. `body` is JSON-encoded unless it is a string. */
export function adminFetch(path, { method = 'GET', body, headers = {} } = {}) {
  const init = { method, headers: { ...adminHeaders, ...headers } };
  if (body !== undefined) {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  return SELF.fetch(`${BASE}${path}`, init);
}

/** POST /api/apply with a JSON body (string bodies are sent verbatim). */
export function applyFetch(body, { ip, headers = {} } = {}) {
  return SELF.fetch(`${BASE}/api/apply`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(ip ? { 'CF-Connecting-IP': ip } : {}),
      ...headers
    },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  });
}

/** A valid application payload with unique email; override any field. */
export function validApplication(overrides = {}) {
  return {
    firstName: 'Alice',
    lastName: 'Martin',
    email: `${uid('app')}@test.example`,
    enrollmentTrack: 'L3 Informatique',
    discord: '@alice',
    ...overrides
  };
}

/** Upsert a raw setting row (bypasses admin API validation). */
export async function putSetting(key, value) {
  await env.DB.prepare(
    'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)'
  ).bind(key, value).run();
}
