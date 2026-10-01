/**
 * Real failures (here: a missing table) answer the generic 500 body and never
 * leak the database or exception message.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { setupSchema, adminFetch, applyFetch, validApplication, BASE } from './helpers.js';

beforeAll(setupSchema);

let renamed = null;
async function breakTable(table) {
  await env.DB.prepare(`ALTER TABLE ${table} RENAME TO ${table}_gone`).run();
  renamed = table;
}
afterEach(async () => {
  if (renamed) {
    await env.DB.prepare(`ALTER TABLE ${renamed}_gone RENAME TO ${renamed}`).run();
    renamed = null;
  }
});

const GENERIC = { error: 'Erreur interne', code: 'internal_error' };

async function expectGeneric500(response) {
  const text = await response.text();
  expect(response.status).toBe(500);
  expect(JSON.parse(text)).toMatchObject({ code: 'internal_error' });
  expect(text).not.toMatch(/no such table|SQLITE|D1_ERROR|members/i);
  return JSON.parse(text);
}

describe.each([
  ['GET /api/admin/members', () => adminFetch('/api/admin/members'), 'members'],
  ['GET /api/admin/stats', () => adminFetch('/api/admin/stats'), 'members'],
  ['GET /api/admin/export', () => adminFetch('/api/admin/export'), 'members'],
  ['GET /api/admin/settings', () => adminFetch('/api/admin/settings'), 'settings'],
  ['PUT /api/admin/settings', () => adminFetch('/api/admin/settings', { method: 'PUT', body: { current_year: '2030-2031' } }), 'settings'],
  ['PUT /api/admin/members/:id', () => adminFetch('/api/admin/members/1', { method: 'PUT', body: { notes: 'x' } }), 'members'],
  ['DELETE /api/admin/members/:id', () => adminFetch('/api/admin/members/1', { method: 'DELETE' }), 'members'],
  ['DELETE /api/admin/members/batch', () => adminFetch('/api/admin/members/batch', { method: 'DELETE', body: { ids: [1] } }), 'members'],
  ['POST /api/admin/members/batch', () => adminFetch('/api/admin/members/batch', { method: 'POST', body: { memberIds: [1], status: 'active' } }), 'members'],
  ['POST /api/admin/import', () => adminFetch('/api/admin/import', { method: 'POST', body: { csv: 'Prénom,Nom,Email\nA,B,a@test.example' } }), 'members'],
  ['GET /api/config', () => SELF.fetch(`${BASE}/api/config`), 'settings'],
  ['GET /api/stats', () => SELF.fetch(`${BASE}/api/stats`), 'members']
])('%s when its table is gone', (_label, call, table) => {
  it('answers a generic 500 without leaking the cause', async () => {
    await breakTable(table);
    const body = await expectGeneric500(await call());
    expect(body.error).toBe(GENERIC.error);
  });
});

describe('POST /api/apply when the settings table is gone', () => {
  it('answers a generic 500 with the French retry message', async () => {
    await breakTable('settings');
    const body = await expectGeneric500(await applyFetch(validApplication()));
    expect(body.error).toBe('Une erreur est survenue. Veuillez réessayer.');
  });
});
