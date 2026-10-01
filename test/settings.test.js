/**
 * Admin settings: allowlist, per-key validation, partial updates, persistence.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { BASE, setupSchema, adminFetch, putSetting } from './helpers.js';

const DEFAULT_TRACKS = ['L1 Informatique', 'L2 Informatique', 'Autre'];

beforeAll(setupSchema);

// Settings are global state: restore a known baseline before every test.
beforeEach(async () => {
  await putSetting('membership_open', 'true');
  await putSetting('current_year', '2024-2025');
  await putSetting('enrollment_tracks', JSON.stringify(DEFAULT_TRACKS));
});

const putSettings = (body) => adminFetch('/api/admin/settings', { method: 'PUT', body });
const readSettings = async () => (await (await adminFetch('/api/admin/settings')).json()).settings;
const readRow = (key) => env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first();

describe('PUT /api/admin/settings - allowlist', () => {
  it('rejects an unknown key and names it', async () => {
    const response = await putSettings({ admin_password: 'x' });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('admin_password');
  });

  it('rejects the whole request and persists nothing when one key is unknown', async () => {
    const response = await putSettings({ current_year: '2030-2031', bogus: 1 });
    expect(response.status).toBe(400);
    expect((await readRow('current_year')).value).toBe('2024-2025');
    expect(await readRow('bogus')).toBeNull();
  });

  it.each(['toString', 'constructor', 'hasOwnProperty', 'valueOf', 'isPrototypeOf'])(
    'treats inherited property name "%s" as an unknown key',
    async (key) => {
      const response = await putSettings({ [key]: 'x' });
      expect(response.status).toBe(400);
      expect((await response.json()).error).toContain(key);
      expect(await readRow(key)).toBeNull();
    }
  );

  it('rejects a __proto__ key sent as raw JSON without polluting Object.prototype', async () => {
    const response = await putSettings('{"__proto__": {"polluted": true}}');
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('__proto__');
    expect({}.polluted).toBeUndefined();
    expect(await readRow('__proto__')).toBeNull();
  });

  it('rejects a __proto__ key mixed with a valid key', async () => {
    const response = await putSettings('{"current_year": "2030-2031", "__proto__": "x"}');
    expect(response.status).toBe(400);
    expect((await readRow('current_year')).value).toBe('2024-2025');
  });

  it.each([
    ['malformed JSON', '{not json'],
    ['empty body', ''],
    ['null', 'null'],
    ['an array', '[]'],
    ['a string', '"membership_open"'],
    ['a number', '42']
  ])('answers 400 (not 500) for %s', async (_label, body) => {
    const response = await putSettings(body);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBeDefined();
  });

  it('accepts an empty object as a no-op', async () => {
    const response = await putSettings({});
    expect(response.status).toBe(200);
    expect(await readSettings()).toMatchObject({ current_year: '2024-2025' });
  });
});

describe('PUT /api/admin/settings - value validation', () => {
  it.each([true, false, 'true', 'false'])('accepts membership_open=%j', async (value) => {
    const response = await putSettings({ membership_open: value });
    expect(response.status).toBe(200);
    expect((await readRow('membership_open')).value).toBe(String(value));
  });

  it.each([['yes'], ['TRUE'], [''], [1], [0], [null], [[]], [{}]])(
    'rejects membership_open=%j',
    async (value) => {
      const response = await putSettings({ membership_open: value });
      expect(response.status).toBe(400);
      expect((await response.json()).error).toContain('membership_open');
      expect((await readRow('membership_open')).value).toBe('true');
    }
  );

  it.each(['2024-2025', '1999-2000', '2099-2100'])('accepts current_year=%s', async (value) => {
    const response = await putSettings({ current_year: value });
    expect(response.status).toBe(200);
    expect((await readRow('current_year')).value).toBe(value);
  });

  it.each([
    ['same year twice', '2024-2024'],
    ['gap of two years', '2024-2026'],
    ['reversed', '2025-2024'],
    ['slash separator', '2024/2025'],
    ['short years', '24-25'],
    ['five digit year', '20245-20246'],
    ['surrounding whitespace', ' 2024-2025 '],
    ['trailing text', '2024-2025x'],
    ['empty string', ''],
    ['a number', 2024],
    ['null', null],
    ['an array', ['2024-2025']]
  ])('rejects current_year given %s', async (_label, value) => {
    const response = await putSettings({ current_year: value });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('current_year');
    expect((await readRow('current_year')).value).toBe('2024-2025');
  });

  it('accepts 1 to 20 tracks of up to 60 characters', async () => {
    const one = await putSettings({ enrollment_tracks: ['Solo'] });
    expect(one.status).toBe(200);

    const tracks = Array.from({ length: 20 }, (_, i) => `Track ${i}`.padEnd(60, 'x'));
    const response = await putSettings({ enrollment_tracks: tracks });
    expect(response.status).toBe(200);
    expect((await readSettings()).enrollment_tracks).toEqual(tracks);
  });

  it.each([
    ['an empty array', []],
    ['21 tracks', Array.from({ length: 21 }, (_, i) => `T${i}`)],
    ['a 61 character track', ['x'.repeat(61)]],
    ['a blank track', ['L1', '   ']],
    ['an empty-string track', ['']],
    ['a numeric track', ['L1', 2]],
    ['a null track', ['L1', null]],
    ['a nested array track', [['L1']]],
    ['an object track', [{ name: 'L1' }]],
    ['a plain string', 'L1'],
    ['an object', { 0: 'L1' }],
    ['null', null],
    ['a number', 3]
  ])('rejects enrollment_tracks given %s', async (_label, value) => {
    const response = await putSettings({ enrollment_tracks: value });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('enrollment_tracks');
    expect((await readSettings()).enrollment_tracks).toEqual(DEFAULT_TRACKS);
  });

  it('lists every invalid key and writes none of the valid ones', async () => {
    const response = await putSettings({
      membership_open: 'maybe',
      current_year: 'nope',
      enrollment_tracks: ['Valid']
    });
    expect(response.status).toBe(400);
    const { error } = await response.json();
    expect(error).toContain('membership_open');
    expect(error).toContain('current_year');
    expect(error).not.toContain('enrollment_tracks');
    expect((await readSettings()).enrollment_tracks).toEqual(DEFAULT_TRACKS);
  });
});

describe('PUT /api/admin/settings - partial updates and persistence', () => {
  it('only changes the keys that were sent', async () => {
    const response = await putSettings({ current_year: '2026-2027' });
    expect(response.status).toBe(200);
    expect(await readSettings()).toMatchObject({
      membership_open: true,
      current_year: '2026-2027',
      enrollment_tracks: DEFAULT_TRACKS
    });
  });

  it('updates several keys in one request', async () => {
    const response = await putSettings({
      membership_open: false,
      current_year: '2027-2028',
      enrollment_tracks: ['Alpha', 'Beta']
    });
    expect(response.status).toBe(200);
    expect(await readSettings()).toMatchObject({
      membership_open: false,
      current_year: '2027-2028',
      enrollment_tracks: ['Alpha', 'Beta']
    });
  });

  it('stores tracks as a JSON string and booleans as text', async () => {
    await putSettings({ enrollment_tracks: ['Alpha', 'Beta'], membership_open: false });
    expect((await readRow('enrollment_tracks')).value).toBe('["Alpha","Beta"]');
    expect((await readRow('membership_open')).value).toBe('false');
  });

  it('is idempotent when the same payload is sent twice', async () => {
    await putSettings({ current_year: '2026-2027' });
    const second = await putSettings({ current_year: '2026-2027' });
    expect(second.status).toBe(200);
    const { results } = await env.DB.prepare("SELECT key FROM settings WHERE key = 'current_year'").all();
    expect(results).toHaveLength(1);
  });

  it('refreshes updated_at on write', async () => {
    await env.DB.prepare("UPDATE settings SET updated_at = '2000-01-01 00:00:00' WHERE key = 'current_year'").run();
    await putSettings({ current_year: '2026-2027' });
    const row = await env.DB.prepare("SELECT updated_at FROM settings WHERE key = 'current_year'").first();
    expect(row.updated_at).not.toBe('2000-01-01 00:00:00');
  });

  it('returns a stored value that is not valid JSON as raw text', async () => {
    await putSetting('current_year', 'not json at all');
    expect((await readSettings()).current_year).toBe('not json at all');
  });
});

describe('settings as seen by the public config endpoint', () => {
  const publicConfig = async () => (await (await SELF.fetch(`${BASE}/api/config`)).json()).config;

  it('reports membershipOpen=true by default', async () => {
    expect((await publicConfig()).membershipOpen).toBe(true);
  });

  it.each([false, 'false'])('reports membershipOpen=false after the admin sets %j', async (value) => {
    await putSettings({ membership_open: value });
    expect((await publicConfig()).membershipOpen).toBe(false);
  });

  it('reports membershipOpen=true again after re-opening', async () => {
    await putSettings({ membership_open: false });
    await putSettings({ membership_open: true });
    expect((await publicConfig()).membershipOpen).toBe(true);
  });

  it('exposes the updated year and tracks', async () => {
    await putSettings({ current_year: '2026-2027', enrollment_tracks: ['Alpha', 'Beta'] });
    expect(await publicConfig()).toMatchObject({
      currentYear: '2026-2027',
      enrollmentTracks: ['Alpha', 'Beta']
    });
  });

  it('falls back to the default tracks when the setting row is missing', async () => {
    await env.DB.prepare("DELETE FROM settings WHERE key = 'enrollment_tracks'").run();
    const config = await publicConfig();
    expect(config.enrollmentTracks).toContain('L3 Informatique');
  });
});
