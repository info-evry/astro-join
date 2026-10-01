/**
 * POST /api/apply: input hardening, limits, normalisation, duplicates.
 * Complements the happy-path coverage in api.test.js.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import {
  BASE, setupSchema, resetMembers, insertMember, getMember, getHistory,
  applyFetch, adminFetch, validApplication, putSetting, uid
} from './helpers.js';

beforeAll(setupSchema);
beforeEach(async () => {
  await resetMembers();
  await putSetting('enrollment_tracks', JSON.stringify(['L3 Informatique', 'M1 Informatique', 'Autre']));
});

const byEmail = (email) => env.DB.prepare('SELECT * FROM members WHERE email = ?').bind(email).first();
const countByEmail = async (email) =>
  (await env.DB.prepare('SELECT COUNT(*) AS n FROM members WHERE email = ?').bind(email).first()).n;

describe('request body handling', () => {
  it.each([
    ['malformed JSON', '{"firstName": '],
    ['an empty body', ''],
    ['JSON null', 'null'],
    ['a JSON array', '[]'],
    ['a JSON string', '"hello"'],
    ['a JSON number', '12']
  ])('answers 400 for %s', async (_label, body) => {
    const response = await applyFetch(body);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBeDefined();
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM members').first()).n).toBe(0);
  });

  it('answers 413 for a body over the 1 MB limit and stores nothing', async () => {
    const response = await applyFetch(validApplication({ discord: '@big', notes: 'x'.repeat(1024 * 1024 + 1) }));
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ code: 'payload_too_large' });
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM members').first()).n).toBe(0);
  });

  it('accepts a body just under the limit', async () => {
    const response = await applyFetch(validApplication({ notes: 'x'.repeat(900 * 1024) }));
    expect(response.status).toBe(200);
  });

  it('ignores unknown extra fields and never lets a client choose the status', async () => {
    const payload = validApplication({ status: 'president', id: 1, approved_at: '2000-01-01', notes: 'hi' });
    const response = await applyFetch(payload);
    expect(response.status).toBe(200);
    const row = await byEmail(payload.email);
    expect(row.status).toBe('pending');
    expect(row.approved_at).toBeNull();
    expect(row.notes).toBeNull();
  });
});

describe('non-string fields', () => {
  const REQUIRED = ['firstName', 'lastName', 'email', 'enrollmentTrack'];
  const BAD_VALUES = [
    ['a number', 42],
    ['an array', ['a']],
    ['an object', { a: 1 }],
    ['a boolean', true],
    ['null', null]
  ];

  describe.each(REQUIRED)('required field %s', (field) => {
    it.each(BAD_VALUES)('is answered with 400 (not 500) when %s', async (_label, value) => {
      const response = await applyFetch(validApplication({ [field]: value }));
      expect(response.status).toBe(400);
      expect((await response.json()).error).toBeDefined();
    });
  });

  describe.each(['phone', 'telegram', 'discord'])('contact field %s', (field) => {
    it.each(BAD_VALUES)('is answered with 400 when %s is the only contact', async (_label, value) => {
      const payload = validApplication({ discord: undefined, [field]: value });
      const response = await applyFetch(payload);
      expect(response.status).toBe(400);
      expect((await response.json()).error).toContain('moyen de contact');
    });

    it.each(BAD_VALUES)('is ignored (not stored) when %s and another contact is valid', async (_label, value) => {
      const other = field === 'discord' ? 'telegram' : 'discord';
      const payload = validApplication({ discord: undefined, [other]: '@valid', [field]: value });
      const response = await applyFetch(payload);
      expect(response.status).toBe(200);
      expect((await byEmail(payload.email))[field]).toBeNull();
    });
  });

  it.each(BAD_VALUES)('treats studentId as absent when %s', async (_label, value) => {
    const payload = validApplication({ studentId: value });
    const response = await applyFetch(payload);
    expect(response.status).toBe(200);
    expect((await byEmail(payload.email)).student_id).toBeNull();
  });
});

describe('length caps', () => {
  // [field, max, extra payload so the application is otherwise valid]
  const CAPS = [
    ['firstName', 100],
    ['lastName', 100],
    ['phone', 30],
    ['telegram', 64],
    ['discord', 64],
    ['studentId', 32]
  ];

  it.each(CAPS)('%s accepts exactly %i characters', async (field, max) => {
    const response = await applyFetch(validApplication({ [field]: 'a'.repeat(max) }));
    expect(response.status).toBe(200);
  });

  it.each(CAPS)('%s rejects %i + 1 characters', async (field, max) => {
    const response = await applyFetch(validApplication({ [field]: 'a'.repeat(max + 1) }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain(`${max} caractères maximum`);
  });

  it('counts the cap after trimming surrounding whitespace', async () => {
    const response = await applyFetch(validApplication({ firstName: `  ${'a'.repeat(100)}  ` }));
    expect(response.status).toBe(200);
  });

  it('accepts an email of exactly 254 characters', async () => {
    const email = `${'a'.repeat(254 - '@x.fr'.length)}@x.fr`;
    expect(email).toHaveLength(254);
    const response = await applyFetch(validApplication({ email }));
    expect(response.status).toBe(200);
    expect(await byEmail(email)).not.toBeNull();
  });

  it('rejects an email of 255 characters', async () => {
    const email = `${'a'.repeat(255 - '@x.fr'.length)}@x.fr`;
    const response = await applyFetch(validApplication({ email }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('254');
  });

  it('reports every violated cap in one response', async () => {
    const response = await applyFetch(validApplication({
      firstName: 'a'.repeat(101),
      lastName: 'a'.repeat(101),
      studentId: 'a'.repeat(33)
    }));
    expect(response.status).toBe(400);
    const { error } = await response.json();
    expect(error).toContain('prénom');
    expect(error).toContain('nom est trop long');
    expect(error).toContain('étudiant');
  });
});

describe('enrollment track', () => {
  it.each([
    ['unknown', 'Chimie'],
    ['wrong case', 'l3 informatique'],
    ['padded', ' L3 Informatique'],
    ['empty', ''],
    ['an inherited property name', 'constructor']
  ])('rejects a %s track', async (_label, track) => {
    const response = await applyFetch(validApplication({ enrollmentTrack: track }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/cursus/i);
  });

  it('rejects a missing track', async () => {
    const payload = validApplication();
    delete payload.enrollmentTrack;
    const response = await applyFetch(payload);
    expect(response.status).toBe(400);
  });

  it('follows the tracks configured by the admin', async () => {
    const update = await adminFetch('/api/admin/settings', {
      method: 'PUT',
      body: { enrollment_tracks: ['Doctorat'] }
    });
    expect(update.status).toBe(200);

    const accepted = await applyFetch(validApplication({ enrollmentTrack: 'Doctorat' }));
    expect(accepted.status).toBe(200);
    const rejected = await applyFetch(validApplication({ enrollmentTrack: 'L3 Informatique' }));
    expect(rejected.status).toBe(400);
  });

  it.each([
    ['unparseable JSON', 'not json'],
    ['an empty array', '[]'],
    ['a non-array', '{"a":1}']
  ])('falls back to the default tracks when the setting holds %s', async (_label, raw) => {
    await putSetting('enrollment_tracks', raw);
    const response = await applyFetch(validApplication({ enrollmentTrack: 'L3 Informatique' }));
    expect(response.status).toBe(200);
  });

  it('falls back to the default tracks when the setting row is missing', async () => {
    await env.DB.prepare("DELETE FROM settings WHERE key = 'enrollment_tracks'").run();
    const response = await applyFetch(validApplication({ enrollmentTrack: 'M2 Informatique' }));
    expect(response.status).toBe(200);
  });
});

describe('contact rule', () => {
  it.each([
    ['no contact at all', {}],
    ['blank phone', { phone: '   ' }],
    ['blank telegram and discord', { telegram: ' ', discord: '\t' }],
    ['empty strings', { phone: '', telegram: '', discord: '' }]
  ])('rejects %s', async (_label, contacts) => {
    const response = await applyFetch(validApplication({ discord: undefined, ...contacts }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('moyen de contact');
  });

  it('stores blank optional contacts as NULL', async () => {
    const payload = validApplication({ phone: '0102030405', telegram: '  ', discord: '' });
    expect((await applyFetch(payload)).status).toBe(200);
    const row = await byEmail(payload.email);
    expect(row.phone).toBe('0102030405');
    expect(row.telegram).toBeNull();
    expect(row.discord).toBeNull();
  });
});

describe('email normalisation and duplicates', () => {
  it('stores the email lower-cased', async () => {
    const key = uid('Mixed');
    const response = await applyFetch(validApplication({ email: `${key.toUpperCase()}@Test.Example` }));
    expect(response.status).toBe(200);
    expect(await byEmail(`${key}@test.example`.toLowerCase())).not.toBeNull();
  });

  it('trims tab/newline padding around the email before storing', async () => {
    const email = `${uid('pad')}@test.example`;
    const response = await applyFetch(validApplication({ email: `\t${email}\n` }));
    expect(response.status).toBe(200);
    expect(await byEmail(email)).not.toBeNull();
  });

  it('detects a duplicate even when the repeat differs in case and padding', async () => {
    const email = `${uid('dup')}@test.example`;
    expect((await applyFetch(validApplication({ email }))).status).toBe(200);

    const repeat = await applyFetch(validApplication({ email: `\t${email.toUpperCase()}\n` }), { ip: '203.0.113.50' });
    expect(repeat.status).toBe(409);
    expect(await countByEmail(email)).toBe(1);
  });

  it.each(['no-at-sign.example', '@no-local.example', 'a@nodot', 'a@b.', 'a b@c.fr', 'a@.fr'])(
    'rejects the invalid email %j',
    async (email) => {
      const response = await applyFetch(validApplication({ email }));
      expect(response.status).toBe(400);
      expect((await response.json()).error).toContain('invalide');
    }
  );

  it('answers 409 for a pending duplicate with an explicit message', async () => {
    const email = `${uid('p')}@test.example`;
    await insertMember({ email, status: 'pending' });
    const response = await applyFetch(validApplication({ email }));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain('en attente');
  });

  it.each(['active', 'honor', 'secretary', 'treasurer', 'president', 'honorary_president', 'vice_president'])(
    'answers 409 (not 500) when the email belongs to a %s member',
    async (status) => {
      const email = `${uid('s')}@test.example`;
      const id = await insertMember({ email, status });
      const response = await applyFetch(validApplication({ email, firstName: 'Intruder' }));
      expect(response.status).toBe(409);
      const row = await getMember(id);
      expect(row.status).toBe(status);
      expect(row.first_name).toBe('First');
    }
  );

  it.each(['rejected', 'expired'])('lets a %s member re-apply by reopening the same row', async (status) => {
    const email = `${uid('r')}@test.example`;
    const id = await insertMember({
      email, status, approved_at: '2020-01-01', expires_at: '2021-08-31', notes: 'kept note'
    });

    const response = await applyFetch(validApplication({
      email, firstName: 'Back', lastName: 'Again', discord: '@back', phone: '0600000000'
    }));
    expect(response.status).toBe(200);
    expect((await response.json()).memberId).toBe(id);

    const row = await getMember(id);
    expect(row).toMatchObject({
      status: 'pending', first_name: 'Back', last_name: 'Again',
      discord: '@back', phone: '0600000000', approved_at: null, expires_at: null, notes: 'kept note'
    });
    expect(await countByEmail(email)).toBe(1);

    const history = await getHistory(id);
    expect(history.at(-1)).toMatchObject({ old_status: status, new_status: 'pending' });
  });

  it('lets a re-applicant be refused again as a pending duplicate', async () => {
    const email = `${uid('rr')}@test.example`;
    await insertMember({ email, status: 'rejected' });
    expect((await applyFetch(validApplication({ email }))).status).toBe(200);
    expect((await applyFetch(validApplication({ email }))).status).toBe(409);
  });

  it('resolves two simultaneous applications for one email to a single row', async () => {
    const email = `${uid('race')}@test.example`;
    const [a, b] = await Promise.all([
      applyFetch(validApplication({ email }), { ip: '203.0.113.60' }),
      applyFetch(validApplication({ email }), { ip: '203.0.113.61' })
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await countByEmail(email)).toBe(1);
  });

  it('records the application in the membership history', async () => {
    const payload = validApplication();
    const { memberId } = await (await applyFetch(payload)).json();
    const history = await getHistory(memberId);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ old_status: null, new_status: 'pending', reason: 'Application submitted' });
  });

  it('returns the new member id and does not echo submitted data', async () => {
    const payload = validApplication({ firstName: 'Echo' });
    const data = await (await applyFetch(payload)).json();
    expect(data.success).toBe(true);
    expect(typeof data.memberId).toBe('number');
    expect(JSON.stringify(data)).not.toContain('Echo');
  });
});

describe('hostile strings', () => {
  const PAYLOADS = [
    '<script>alert(1)</script>',
    '"><img src=x onerror=alert(1)>',
    "'; DROP TABLE members; --",
    '</script><svg/onload=alert(1)>',
    String.raw`back\slash "quote" 'apos' & <b>`,
    '\u0000null\u0000byte',
    '😀 émoji ñ 中文'
  ];

  it.each(PAYLOADS)('stores %j verbatim and returns it JSON-safe', async (payload) => {
    const email = `${uid('xss')}@test.example`;
    const response = await applyFetch(validApplication({
      email, firstName: payload, lastName: payload, telegram: payload, studentId: payload.slice(0, 32)
    }));
    expect(response.status).toBe(200);

    const row = await byEmail(email);
    expect(row.first_name).toBe(payload.trim());
    expect(row.last_name).toBe(payload.trim());
    expect(row.telegram).toBe(payload.trim());

    const list = await adminFetch('/api/admin/members');
    expect(list.headers.get('Content-Type')).toContain('application/json');
    const data = JSON.parse(await list.text());
    expect(data.members.find((m) => m.email === email).first_name).toBe(payload.trim());
  });

  it('keeps the members table intact after a SQL-looking payload', async () => {
    const response = await applyFetch(validApplication({ firstName: "Robert'); DROP TABLE members;--" }));
    expect(response.status).toBe(200);
    const stats = await (await SELF.fetch(`${BASE}/api/stats`)).json();
    expect(stats.stats.pendingApplications).toBe(1);
  });
});

describe('membership_open is enforced by POST /api/apply', () => {
  afterEach(() => putSetting('membership_open', 'true'));

  it.each(['false', JSON.stringify(false)])('answers 403 membership_closed when the setting is %s', async (value) => {
    await putSetting('membership_open', value);
    const payload = validApplication();

    const response = await applyFetch(payload);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "Les adhésions sont actuellement fermées. Revenez plus tard ou contactez l'association.",
      code: 'membership_closed'
    });
    expect(await countByEmail(payload.email)).toBe(0);
  });

  it('refuses a closed membership before looking at the body', async () => {
    await putSetting('membership_open', 'false');
    expect((await applyFetch('{not json')).status).toBe(403);
  });

  it('accepts applications again once re-opened', async () => {
    await putSetting('membership_open', 'false');
    await putSetting('membership_open', 'true');
    expect((await applyFetch(validApplication())).status).toBe(200);
  });

  it('is reported by /api/config as membershipOpen=false', async () => {
    await putSetting('membership_open', 'false');
    const config = (await (await SELF.fetch(`${BASE}/api/config`)).json()).config;
    expect(config.membershipOpen).toBe(false);
  });
});

describe('email handling shared with the admin edit', () => {
  it('trims and lower-cases the email like the admin PUT does', async () => {
    const response = await applyFetch(validApplication({ email: '  Trim.Me@Test.Example  ' }));
    expect(response.status).toBe(200);
    expect(await byEmail('trim.me@test.example')).not.toBeNull();
  });

  it('records the application and its history row in one batch', async () => {
    const payload = validApplication();
    const { memberId } = await (await applyFetch(payload)).json();
    expect(await getHistory(memberId)).toMatchObject([{ old_status: null, new_status: 'pending', reason: 'Application submitted' }]);
  });
});
