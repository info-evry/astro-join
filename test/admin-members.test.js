/**
 * Admin member management: listing, edit, status transitions, bureau
 * uniqueness, delete, batch, history and expiry bookkeeping.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import {
  BASE, setupSchema, resetMembers, insertMember, getMember, getHistory, adminFetch, uid
} from './helpers.js';

beforeAll(setupSchema);
beforeEach(resetMembers);
afterEach(() => vi.useRealTimers());

const put = (id, body) => adminFetch(`/api/admin/members/${id}`, { method: 'PUT', body });
const del = (id) => adminFetch(`/api/admin/members/${id}`, { method: 'DELETE' });
const batch = (body) => adminFetch('/api/admin/members/batch', { method: 'POST', body });
const countMembers = async () => (await env.DB.prepare('SELECT COUNT(*) AS n FROM members').first()).n;

/** Academic year ends on 31 August: from September on, it is next year's. */
function expectedExpiry(now = new Date()) {
  const year = now.getUTCMonth() >= 8 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
  return `${year}-08-31`;
}

describe('GET /api/admin/members', () => {
  it('lists newest first and exposes the enrollment_number migration column', async () => {
    const oldest = await insertMember({ created_at: '2024-01-01 10:00:00' });
    const newest = await insertMember({ created_at: '2025-06-01 10:00:00', enrollment_number: 'E-42' });
    const middle = await insertMember({ created_at: '2024-09-01 10:00:00' });

    const { members } = await (await adminFetch('/api/admin/members')).json();

    expect(members.map((m) => m.id)).toEqual([newest, middle, oldest]);
    expect(members[0]).toHaveProperty('enrollment_number', 'E-42');
    expect(members[1]).toHaveProperty('enrollment_number', null);
  });

  it('counts members per status', async () => {
    await insertMember({ status: 'active' });
    await insertMember({ status: 'active' });
    await insertMember({ status: 'pending' });
    await insertMember({ status: 'rejected' });
    await insertMember({ status: 'expired' });
    await insertMember({ status: 'expired' });

    const { stats } = await (await adminFetch('/api/admin/members')).json();

    expect(stats).toEqual({ total: 6, active: 2, pending: 1, rejected: 1, expired: 2 });
  });

  it('returns every column needed by the dashboard', async () => {
    await insertMember({ notes: 'n', phone: '1', telegram: '@t', student_id: 'S1', enrollment_number: 'E1' });
    const { members } = await (await adminFetch('/api/admin/members')).json();
    expect(Object.keys(members[0])).toEqual(expect.arrayContaining([
      'id', 'first_name', 'last_name', 'email', 'student_id', 'enrollment_number', 'enrollment_track',
      'phone', 'telegram', 'discord', 'status', 'notes', 'created_at', 'approved_at', 'expires_at'
    ]));
  });
});

describe('GET /api/admin/stats', () => {
  it('counts honor and bureau members as active and omits pending/rejected from tracks', async () => {
    await insertMember({ status: 'active', enrollment_track: 'L3 Informatique' });
    await insertMember({ status: 'honor', enrollment_track: 'L3 Informatique' });
    await insertMember({ status: 'president', enrollment_track: 'M1 Informatique' });
    await insertMember({ status: 'pending', enrollment_track: 'Autre' });
    await insertMember({ status: 'rejected', enrollment_track: 'Autre' });
    await insertMember({ status: 'expired', enrollment_track: 'Autre' });

    const data = await (await adminFetch('/api/admin/stats')).json();

    expect(data.stats).toEqual({ total: 6, active: 3, pending: 1, rejected: 1, expired: 1 });
    expect(data.trackDistribution).toEqual([
      { enrollment_track: 'L3 Informatique', count: 2 },
      { enrollment_track: 'M1 Informatique', count: 1 }
    ]);
  });

  it('lists the bureau in role order with labels', async () => {
    await insertMember({ status: 'treasurer', last_name: 'T' });
    await insertMember({ status: 'honorary_president', last_name: 'H' });
    await insertMember({ status: 'president', last_name: 'P' });
    await insertMember({ status: 'secretary', last_name: 'S' });
    await insertMember({ status: 'vice_president', last_name: 'V' });
    await insertMember({ status: 'active', last_name: 'A' });

    const { bureau } = await (await adminFetch('/api/admin/stats')).json();

    expect(bureau.map((m) => m.status)).toEqual([
      'president', 'vice_president', 'secretary', 'treasurer', 'honorary_president'
    ]);
    expect(bureau[0].statusLabel).toBe('Président');
    expect(bureau[4].statusLabel).toBe("Président d'honneur");
  });

  it('caps recent applications at 10, pending only, newest first', async () => {
    for (let i = 0; i < 12; i++) {
      await insertMember({ status: 'pending', created_at: `2025-01-${String(i + 1).padStart(2, '0')} 08:00:00` });
    }
    await insertMember({ status: 'active', created_at: '2026-01-01 08:00:00' });

    const { recentApplications } = await (await adminFetch('/api/admin/stats')).json();

    expect(recentApplications).toHaveLength(10);
    expect(recentApplications.every((m) => m.status === 'pending')).toBe(true);
    expect(recentApplications[0].created_at).toBe('2025-01-12 08:00:00');
  });

  it('publishes the full status vocabulary for the UI', async () => {
    const data = await (await adminFetch('/api/admin/stats')).json();
    expect(data.validStatuses).toEqual([
      'pending', 'active', 'honor', 'secretary', 'treasurer', 'president',
      'honorary_president', 'vice_president', 'rejected', 'expired'
    ]);
    expect(Object.keys(data.statusLabels).sort()).toEqual([...data.validStatuses].sort());
  });

  it('returns zeroes and empty lists on an empty database', async () => {
    const data = await (await adminFetch('/api/admin/stats')).json();
    expect(data.stats).toEqual({ total: 0, active: 0, pending: 0, rejected: 0, expired: 0 });
    expect(data.bureau).toEqual([]);
    expect(data.trackDistribution).toEqual([]);
    expect(data.recentApplications).toEqual([]);
  });
});

describe('PUT /api/admin/members/:id - editing fields', () => {
  it('trims values, lower-cases the email and stores blank optionals as NULL', async () => {
    const id = await insertMember({ phone: '0102', telegram: '@old', notes: 'old' });

    const response = await put(id, {
      firstName: '  Zoé ', lastName: ' Durand  ', email: `  ${uid('Z')}@Test.Example `.toUpperCase(),
      phone: '   ', telegram: '', notes: ''
    });

    expect(response.status).toBe(200);
    const row = await getMember(id);
    expect(row.first_name).toBe('Zoé');
    expect(row.last_name).toBe('Durand');
    expect(row.email).toBe(row.email.toLowerCase().trim());
    expect(row.phone).toBeNull();
    expect(row.telegram).toBeNull();
    expect(row.notes).toBeNull();
  });

  it('stores enrollmentNumber in the migrated column', async () => {
    const id = await insertMember();
    expect((await put(id, { enrollmentNumber: ' 20240042 ' })).status).toBe(200);
    expect((await getMember(id)).enrollment_number).toBe('20240042');
    expect((await put(id, { enrollmentNumber: null })).status).toBe(200);
    expect((await getMember(id)).enrollment_number).toBeNull();
  });

  it('updates studentId, track, phone, telegram and discord', async () => {
    const id = await insertMember();
    const response = await put(id, {
      studentId: 'S99', enrollmentTrack: 'M2 Informatique', phone: '0600', telegram: '@tg', discord: '@dc'
    });
    expect(response.status).toBe(200);
    expect(await getMember(id)).toMatchObject({
      student_id: 'S99', enrollment_track: 'M2 Informatique', phone: '0600', telegram: '@tg', discord: '@dc'
    });
  });

  it('leaves untouched fields and other members alone', async () => {
    const id = await insertMember({ first_name: 'Keep', notes: 'keep me' });
    const other = await insertMember({ first_name: 'Other' });

    await put(id, { lastName: 'Changed' });

    expect(await getMember(id)).toMatchObject({ first_name: 'Keep', last_name: 'Changed', notes: 'keep me' });
    expect((await getMember(other)).last_name).toBe('Last');
  });

  it('refreshes updated_at', async () => {
    const id = await insertMember();
    await env.DB.prepare("UPDATE members SET updated_at = '2000-01-01 00:00:00' WHERE id = ?").bind(id).run();
    await put(id, { notes: 'x' });
    expect((await getMember(id)).updated_at).not.toBe('2000-01-01 00:00:00');
  });

  it('does not write a history row for a pure field edit', async () => {
    const id = await insertMember();
    await put(id, { firstName: 'Renamed' });
    expect(await getHistory(id)).toEqual([]);
  });

  it('stores hostile text verbatim', async () => {
    const id = await insertMember();
    const payload = '"><img src=x onerror=alert(1)>\'';
    expect((await put(id, { notes: payload, firstName: payload })).status).toBe(200);
    expect(await getMember(id)).toMatchObject({ notes: payload, first_name: payload });
  });

  it.each([
    ['an empty object', {}],
    ['only unknown fields', { nickname: 'x', is_admin: true }]
  ])('answers 400 for %s', async (_label, body) => {
    const id = await insertMember();
    const response = await put(id, body);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Aucune modification fournie', code: 'no_changes' });
  });

  it.each([
    ['malformed JSON', '{oops'],
    ['an empty body', ''],
    ['JSON null', 'null'],
    ['a JSON array', '[1]'],
    ['a JSON string', '"x"']
  ])('answers 400 (not 500) for %s', async (_label, body) => {
    const id = await insertMember();
    const response = await put(id, body);
    expect(response.status).toBe(400);
  });

  it.each([
    ['firstName', 5], ['firstName', null], ['firstName', ''], ['firstName', '   '],
    ['lastName', ['x']], ['lastName', ''],
    ['email', 12], ['email', null], ['email', ''], ['email', 'not-an-email'],
    ['enrollmentTrack', 3], ['enrollmentTrack', null],
    ['studentId', 7], ['studentId', { a: 1 }],
    ['phone', true], ['telegram', []], ['discord', 1.5],
    ['enrollmentNumber', 9], ['notes', { a: 1 }]
  ])('answers 400 and changes nothing for %s = %j', async (field, value) => {
    const id = await insertMember({ first_name: 'Stable' });
    const before = await getMember(id);

    const response = await put(id, { notes: 'would be written', [field]: value });

    expect(response.status).toBe(400);
    expect(await getMember(id)).toEqual(before);
  });

  it('answers 409 when the new email belongs to another member', async () => {
    const taken = `${uid('taken')}@test.example`;
    await insertMember({ email: taken });
    const id = await insertMember();

    const response = await put(id, { email: taken.toUpperCase() });

    expect(response.status).toBe(409);
    expect((await getMember(id)).email).not.toBe(taken);
  });

  it('lets a member keep their own email', async () => {
    const email = `${uid('own')}@test.example`;
    const id = await insertMember({ email });
    expect((await put(id, { email })).status).toBe(200);
  });

  it('answers 404 for an unknown id', async () => {
    expect((await put(987_654, { notes: 'x' })).status).toBe(404);
  });

  it.each(['abc', '0', '-1', '1.5', '12abc', '1e3', '0x10', '99999999999999999999', 'batch', '%20'])(
    'answers 400 invalid_id for the malformed id %j without touching real members',
    async (rawId) => {
      const real = await insertMember({ first_name: 'Safe' });
      const response = await adminFetch(`/api/admin/members/${rawId}`, { method: 'PUT', body: { firstName: 'Hacked' } });
      expect(response.status).toBe(400);
      expect((await response.json()).code).toBe('invalid_id');
      expect((await getMember(real)).first_name).toBe('Safe');
    }
  );

  it('does not let "<id>abc" address the member with that numeric prefix', async () => {
    const id = await insertMember({ first_name: 'Prefix' });
    const response = await adminFetch(`/api/admin/members/${id}abc`, { method: 'PUT', body: { firstName: 'Hacked' } });
    expect(response.status).toBe(400);
    expect((await getMember(id)).first_name).toBe('Prefix');
  });
});

describe('PUT /api/admin/members/:id - status transitions', () => {
  it.each(['superuser', 'ACTIVE', '', 5, null, ['active'], '__proto__', 'constructor'])(
    'rejects the invalid status %j and leaves the member unchanged',
    async (status) => {
      const id = await insertMember({ status: 'pending' });
      const response = await put(id, { status });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: 'invalid_status' });
      expect((await getMember(id)).status).toBe('pending');
      expect(await getHistory(id)).toEqual([]);
    }
  );

  it('approves a pending member: status, approved_at, expiry and history', async () => {
    const id = await insertMember({ status: 'pending' });

    expect((await put(id, { status: 'active', reason: 'Dossier complet' })).status).toBe(200);

    const row = await getMember(id);
    expect(row.status).toBe('active');
    expect(row.approved_at).not.toBeNull();
    expect(row.expires_at).toBe(expectedExpiry());
    expect(await getHistory(id)).toMatchObject([
      { old_status: 'pending', new_status: 'active', reason: 'Dossier complet' }
    ]);
  });

  it('uses a default history reason when none is given', async () => {
    const id = await insertMember({ status: 'pending' });
    await put(id, { status: 'rejected' });
    expect((await getHistory(id))[0].reason).toBe('Status updated by admin');
  });

  it('does not set approval dates when rejecting', async () => {
    const id = await insertMember({ status: 'pending' });
    await put(id, { status: 'rejected' });
    const row = await getMember(id);
    expect(row.approved_at).toBeNull();
    expect(row.expires_at).toBeNull();
  });

  it('keeps existing dates when moving between active-like statuses', async () => {
    const id = await insertMember({ status: 'active', approved_at: '2025-01-01 00:00:00', expires_at: '2025-08-31' });

    await put(id, { status: 'honor' });

    expect(await getMember(id)).toMatchObject({
      status: 'honor', approved_at: '2025-01-01 00:00:00', expires_at: '2025-08-31'
    });
  });

  it.each(['expired', 'rejected'])('renews the dates when reactivating a member who was %s', async (from) => {
    const id = await insertMember({ status: from, approved_at: '2020-01-01 00:00:00', expires_at: '2021-08-31' });

    await put(id, { status: 'active' });

    const row = await getMember(id);
    expect(row.expires_at).toBe(expectedExpiry());
    expect(row.approved_at).not.toBe('2020-01-01 00:00:00');
  });

  it('does not log history or rewrite dates when the status is unchanged', async () => {
    const id = await insertMember({ status: 'active', approved_at: '2025-01-01 00:00:00', expires_at: '2025-08-31' });
    await put(id, { status: 'active', notes: 'same status' });
    expect(await getHistory(id)).toEqual([]);
    expect((await getMember(id)).expires_at).toBe('2025-08-31');
  });

  it('records one history row per transition in order', async () => {
    const id = await insertMember({ status: 'pending' });
    await put(id, { status: 'active' });
    await put(id, { status: 'expired' });
    await put(id, { status: 'active' });
    expect((await getHistory(id)).map((h) => [h.old_status, h.new_status])).toEqual([
      ['pending', 'active'], ['active', 'expired'], ['expired', 'active']
    ]);
  });

  it('applies a status together with field edits in one request', async () => {
    const id = await insertMember({ status: 'pending' });
    const response = await put(id, { status: 'active', firstName: 'Both', notes: 'edited' });
    expect(response.status).toBe(200);
    expect(await getMember(id)).toMatchObject({ status: 'active', first_name: 'Both', notes: 'edited' });
    expect(await getHistory(id)).toHaveLength(1);
  });

  it('computes the expiry year from the date: August stays, September rolls over', async () => {
    const approveAt = async (isoDate) => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(isoDate));
      const id = await insertMember({ status: 'pending' });
      await put(id, { status: 'active' });
      vi.useRealTimers();
      return (await getMember(id)).expires_at;
    };

    expect(await approveAt('2031-08-31T12:00:00Z')).toBe('2031-08-31');
    expect(await approveAt('2031-09-01T12:00:00Z')).toBe('2032-08-31');
    expect(await approveAt('2031-01-15T12:00:00Z')).toBe('2031-08-31');
  });
});

describe('PUT /api/admin/members/:id - bureau roles', () => {
  const UNIQUE_ROLES = ['president', 'vice_president', 'secretary', 'treasurer'];

  it.each(UNIQUE_ROLES)('assigns %s, sets dates and logs history', async (role) => {
    const id = await insertMember({ status: 'pending' });

    expect((await put(id, { status: role })).status).toBe(200);

    const row = await getMember(id);
    expect(row.status).toBe(role);
    expect(row.approved_at).not.toBeNull();
    expect(row.expires_at).toBe(expectedExpiry());
    expect(await getHistory(id)).toMatchObject([{ old_status: 'pending', new_status: role }]);
  });

  it.each(UNIQUE_ROLES)('refuses a second %s and names the holder', async (role) => {
    const holder = await insertMember({ status: role, first_name: 'Holder', last_name: 'Person' });
    const candidate = await insertMember({ status: 'active' });

    const response = await put(candidate, { status: role });

    expect(response.status).toBe(409);
    const { error, code } = await response.json();
    expect(code).toBe('conflict');
    expect(error).toContain('Holder Person');
    expect((await getMember(candidate)).status).toBe('active');
    expect((await getMember(holder)).status).toBe(role);
    expect(await getHistory(candidate)).toEqual([]);
  });

  it('allows several honorary presidents (the role is not unique)', async () => {
    const a = await insertMember({ status: 'honorary_president' });
    const b = await insertMember({ status: 'active' });
    expect((await put(b, { status: 'honorary_president' })).status).toBe(200);
    expect((await getMember(a)).status).toBe('honorary_president');
    expect((await getMember(b)).status).toBe('honorary_president');
  });

  it('lets the current holder be re-saved in their own role', async () => {
    const id = await insertMember({ status: 'president' });
    expect((await put(id, { status: 'president', notes: 'still president' })).status).toBe(200);
    expect((await getMember(id)).status).toBe('president');
  });

  it('frees a role once its holder is demoted', async () => {
    const first = await insertMember({ status: 'treasurer' });
    const second = await insertMember({ status: 'active' });
    expect((await put(second, { status: 'treasurer' })).status).toBe(409);

    expect((await put(first, { status: 'active' })).status).toBe(200);
    expect((await put(second, { status: 'treasurer' })).status).toBe(200);
  });

  it('frees a role once its holder is deleted', async () => {
    const first = await insertMember({ status: 'secretary' });
    const second = await insertMember({ status: 'active' });
    await del(first);
    expect((await put(second, { status: 'secretary' })).status).toBe(200);
  });

  it('moves a member between roles and logs old and new role', async () => {
    const id = await insertMember({ status: 'secretary', approved_at: '2025-01-01 00:00:00', expires_at: '2025-08-31' });

    expect((await put(id, { status: 'treasurer' })).status).toBe(200);

    expect(await getMember(id)).toMatchObject({ status: 'treasurer', expires_at: '2025-08-31' });
    expect(await getHistory(id)).toMatchObject([{ old_status: 'secretary', new_status: 'treasurer' }]);
  });

  it('records a single history row when a role is assigned together with field edits', async () => {
    const id = await insertMember({ status: 'active' });
    expect((await put(id, { status: 'president', notes: 'elected', firstName: 'Prez' })).status).toBe(200);
    expect(await getMember(id)).toMatchObject({ status: 'president', notes: 'elected', first_name: 'Prez' });
    expect(await getHistory(id)).toHaveLength(1);
  });

  it('sets approval dates when promoting a pending member while also editing fields', async () => {
    // The edit modal always submits the full form, so this is the path the UI takes.
    const id = await insertMember({ status: 'pending' });

    const response = await put(id, {
      firstName: 'Promoted', lastName: 'Member', email: `${uid('prom')}@test.example`,
      studentId: '', enrollmentTrack: 'L3 Informatique', status: 'secretary', notes: ''
    });

    expect(response.status).toBe(200);
    const row = await getMember(id);
    expect(row.status).toBe('secretary');
    expect(row.approved_at).not.toBeNull();
    expect(row.expires_at).toBe(expectedExpiry());
  });

  it('keeps a failed role assignment from applying the other edits', async () => {
    await insertMember({ status: 'president' });
    const id = await insertMember({ status: 'active', first_name: 'Before' });

    const response = await put(id, { status: 'president', firstName: 'After' });

    expect(response.status).toBe(409);
    expect(await getMember(id)).toMatchObject({ status: 'active', first_name: 'Before' });
  });

  it('prevents two simultaneous requests from both claiming a unique role', async () => {
    const a = await insertMember({ status: 'active' });
    const b = await insertMember({ status: 'active' });

    const [ra, rb] = await Promise.all([put(a, { status: 'president' }), put(b, { status: 'president' })]);

    expect([ra.status, rb.status].sort()).toEqual([200, 409]);
    const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM members WHERE status = 'president'").first();
    expect(n).toBe(1);
  });
});

describe('DELETE /api/admin/members/:id', () => {
  it('deletes the member and cascades its history', async () => {
    const id = await insertMember({ status: 'pending' });
    await put(id, { status: 'active' });
    expect(await getHistory(id)).toHaveLength(1);

    expect((await del(id)).status).toBe(200);

    expect(await getMember(id)).toBeNull();
    expect(await getHistory(id)).toEqual([]);
  });

  it('only deletes the targeted member', async () => {
    const keep = await insertMember();
    const gone = await insertMember();
    await del(gone);
    expect(await getMember(keep)).not.toBeNull();
    expect(await countMembers()).toBe(1);
  });

  it('answers 404 the second time', async () => {
    const id = await insertMember();
    expect((await del(id)).status).toBe(200);
    expect((await del(id)).status).toBe(404);
  });

  it.each(['abc', '0', '-1', '1.5', '12abc', '99999999999999999999'])(
    'answers 400 invalid_id for the malformed id %j and deletes nothing',
    async (rawId) => {
      await insertMember();
      const response = await adminFetch(`/api/admin/members/${rawId}`, { method: 'DELETE' });
      expect(response.status).toBe(400);
      expect((await response.json()).code).toBe('invalid_id');
      expect(await countMembers()).toBe(1);
    }
  );

  it('does not let "<id>abc" delete the member with that numeric prefix', async () => {
    const id = await insertMember();
    const response = await adminFetch(`/api/admin/members/${id}abc`, { method: 'DELETE' });
    expect(response.status).toBe(400);
    expect(await getMember(id)).not.toBeNull();
  });
});

describe('POST /api/admin/members/batch', () => {
  it('approves members: status, dates and one history row each', async () => {
    const ids = [await insertMember(), await insertMember(), await insertMember()];

    const response = await batch({ memberIds: ids, status: 'active', reason: 'Bulk approved' });

    expect(response.status).toBe(200);
    expect((await response.json()).message).toContain('3 membre(s)');
    for (const id of ids) {
      const row = await getMember(id);
      expect(row.status).toBe('active');
      expect(row.approved_at).not.toBeNull();
      expect(row.expires_at).toBe(expectedExpiry());
      expect(await getHistory(id)).toMatchObject([{ new_status: 'active', reason: 'Bulk approved' }]);
    }
  });

  it.each(['rejected', 'expired'])('sets %s without approval dates', async (status) => {
    const id = await insertMember();
    expect((await batch({ memberIds: [id], status })).status).toBe(200);
    const row = await getMember(id);
    expect(row.status).toBe(status);
    expect(row.approved_at).toBeNull();
    expect(row.expires_at).toBeNull();
  });

  it('uses a default history reason', async () => {
    const id = await insertMember();
    await batch({ memberIds: [id], status: 'expired' });
    expect((await getHistory(id))[0].reason).toBe('Batch update by admin');
  });

  it('leaves members outside the id list alone', async () => {
    const target = await insertMember();
    const bystander = await insertMember();
    await batch({ memberIds: [target], status: 'rejected' });
    expect((await getMember(bystander)).status).toBe('pending');
  });

  it('de-duplicates ids so each member gets one history row', async () => {
    const id = await insertMember();
    const response = await batch({ memberIds: [id, id, id], status: 'active' });
    expect((await response.json()).message).toContain('1 membre(s)');
    expect(await getHistory(id)).toHaveLength(1);
  });

  it('skips ids that do not exist and reports only real updates', async () => {
    const id = await insertMember();
    const response = await batch({ memberIds: [id, 987_654, 987_655], status: 'active' });
    expect(response.status).toBe(200);
    expect((await response.json()).message).toContain('1 membre(s)');
    const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM membership_history').first();
    expect(n).toBe(1);
  });

  it('answers 404 when none of the ids exist', async () => {
    const response = await batch({ memberIds: [987_654], status: 'active' });
    expect(response.status).toBe(404);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM membership_history').first()).n).toBe(0);
  });

  it('handles more ids than a single D1 query can bind (120 members)', async () => {
    const ids = [];
    for (let i = 0; i < 120; i++) ids.push(await insertMember());

    const response = await batch({ memberIds: ids, status: 'active' });

    expect(response.status).toBe(200);
    expect((await response.json()).message).toContain('120 membre(s)');
    const active = await env.DB.prepare("SELECT COUNT(*) AS n FROM members WHERE status = 'active'").first();
    const history = await env.DB.prepare('SELECT COUNT(*) AS n FROM membership_history').first();
    expect([active.n, history.n]).toEqual([120, 120]);
  });

  it('accepts exactly 1000 ids and rejects 1001', async () => {
    const ids = Array.from({ length: 1001 }, (_, i) => i + 1_000_000);
    expect((await batch({ memberIds: ids.slice(0, 1000), status: 'active' })).status).toBe(404);

    const tooMany = await batch({ memberIds: ids, status: 'active' });
    expect(tooMany.status).toBe(400);
    expect((await tooMany.json()).error).toContain('1000');
  });

  it.each([
    ['missing', undefined],
    ['null', null],
    ['an empty array', []],
    ['a string', '1,2'],
    ['an object', { 0: 1 }],
    ['a number', 5]
  ])('rejects memberIds that is %s', async (_label, memberIds) => {
    const response = await batch({ memberIds, status: 'active' });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'Aucun membre spécifié', code: 'no_members' });
  });

  it.each([
    ['non-numeric strings', ['a']],
    ['floats', [1.5]],
    ['negatives', [-1]],
    ['zero', [0]],
    ['null entries', [null]],
    ['objects', [{ id: 1 }]],
    ['nested arrays', [[1]]],
    ['booleans', [true]],
    ['unsafe integers', [2 ** 60]],
    ['a mix of valid and invalid', [1, 'x']]
  ])('rejects memberIds containing %s', async (_label, memberIds) => {
    const response = await batch({ memberIds, status: 'active' });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'invalid_id' });
  });

  it.each(['pending', 'president', 'secretary', 'honor', 'superuser', '', null, 1, undefined])(
    'rejects the batch status %j',
    async (status) => {
      const id = await insertMember();
      const response = await batch({ memberIds: [id], status });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: 'invalid_status' });
      expect((await getMember(id)).status).toBe('pending');
    }
  );

  it.each([5, ['x'], { a: 1 }, true])('rejects a non-string reason %j', async (reason) => {
    const id = await insertMember();
    const response = await batch({ memberIds: [id], status: 'active', reason });
    expect(response.status).toBe(400);
    expect((await getMember(id)).status).toBe('pending');
  });

  it.each([
    ['malformed JSON', '{oops'],
    ['an empty body', ''],
    ['JSON null', 'null'],
    ['a JSON array', '[1,2]']
  ])('answers 400 (not 500) for %s', async (_label, body) => {
    expect((await batch(body)).status).toBe(400);
  });

  it('does not treat "batch" as a member id for PUT or DELETE', async () => {
    const id = await insertMember();
    // PUT has no batch route, so "batch" is read as an id; DELETE batch is the
    // batch route itself and (without a body) refuses to run.
    expect((await put('batch', { notes: 'x' })).status).toBe(400);
    expect((await del('batch')).status).toBe(400);
    expect(await getMember(id)).not.toBeNull();
  });
});

const SQL_TIMESTAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

describe('active members are counted the same way everywhere', () => {
  it('counts active, honor and every bureau role in /api/stats, the admin list and the admin stats', async () => {
    for (const status of ['active', 'honor', 'president', 'honorary_president', 'vice_president', 'pending', 'rejected', 'expired']) {
      await insertMember({ status });
    }

    const publicStats = (await (await SELF.fetch(`${BASE}/api/stats`)).json()).stats;
    const list = (await (await adminFetch('/api/admin/members')).json()).stats;
    const admin = (await (await adminFetch('/api/admin/stats')).json()).stats;

    expect(publicStats).toEqual({ activeMembers: 5, pendingApplications: 1 });
    expect(list).toEqual({ total: 8, active: 5, pending: 1, rejected: 1, expired: 1 });
    expect(admin).toEqual(list);
  });
});

describe('approved_at format', () => {
  it.each([
    ['a single update', (id) => put(id, { status: 'active' })],
    ['a batch', (id) => batch({ memberIds: [id], status: 'active' })]
  ])('is the SQLite timestamp format (like created_at) after %s', async (_label, approve) => {
    const id = await insertMember({ status: 'pending' });
    expect((await approve(id)).status).toBe(200);
    expect((await getMember(id)).approved_at).toMatch(SQL_TIMESTAMP);
  });
});

describe('PUT /api/admin/members/:id - validation and atomicity', () => {
  it('stores a trimmed, lower-cased email', async () => {
    const id = await insertMember();
    expect((await put(id, { email: '  Mixed.Case@Test.Example ' })).status).toBe(200);
    expect((await getMember(id)).email).toBe('mixed.case@test.example');
  });

  it('caps notes at 1000 characters (after trimming)', async () => {
    const id = await insertMember();
    expect((await put(id, { notes: `  ${'n'.repeat(1000)}  ` })).status).toBe(200);
    const response = await put(id, { notes: 'n'.repeat(1001) });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'invalid_field' });
  });

  it.each([
    ['firstName', 101], ['lastName', 101], ['email', 250], ['studentId', 33], ['phone', 31],
    ['telegram', 65], ['discord', 65], ['enrollmentNumber', 33]
  ])('caps %s at the shared limit', async (field, length) => {
    const id = await insertMember({ first_name: 'Stable' });
    const value = field === 'email' ? `${'x'.repeat(length)}@test.example` : 'x'.repeat(length);
    const response = await put(id, { [field]: value });
    expect(response.status).toBe(400);
    expect((await getMember(id)).first_name).toBe('Stable');
  });

  it('only accepts a configured enrollment track', async () => {
    const id = await insertMember({ enrollment_track: 'L3 Informatique' });
    const refused = await put(id, { enrollmentTrack: 'Made up track' });
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ code: 'invalid_track' });
    expect((await getMember(id)).enrollment_track).toBe('L3 Informatique');

    expect((await put(id, { enrollmentTrack: 'M1 Informatique' })).status).toBe(200);
    expect((await getMember(id)).enrollment_track).toBe('M1 Informatique');
  });

  it('lets a member keep a track outside the configured list (legacy or imported data)', async () => {
    const id = await insertMember({ enrollment_track: 'Doctorat, Info' });
    expect((await put(id, { enrollmentTrack: 'Doctorat, Info', notes: 'edited in the dashboard' })).status).toBe(200);
    expect((await getMember(id)).notes).toBe('edited in the dashboard');
  });

  it.each([5, ['x'], { a: 1 }, true])('rejects a non-string reason %j', async (reason) => {
    const id = await insertMember({ status: 'pending' });
    const response = await put(id, { status: 'active', reason });
    expect(response.status).toBe(400);
    expect((await getMember(id)).status).toBe('pending');
  });

  it('applies nothing when a duplicate email accompanies a role assignment', async () => {
    const taken = `${uid('dup')}@test.example`;
    await insertMember({ email: taken });
    const id = await insertMember({ status: 'active', first_name: 'Before' });

    const response = await put(id, { status: 'president', email: taken, firstName: 'After', notes: 'edited' });

    expect(response.status).toBe(409);
    expect(await getMember(id)).toMatchObject({ status: 'active', first_name: 'Before', notes: null });
    expect(await getHistory(id)).toEqual([]);
    const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM members WHERE status = 'president'").first();
    expect(n).toBe(0);
  });

  it('applies nothing when a duplicate email accompanies a plain status change', async () => {
    const taken = `${uid('dup')}@test.example`;
    await insertMember({ email: taken });
    const id = await insertMember({ status: 'pending' });

    expect((await put(id, { status: 'active', email: taken })).status).toBe(409);

    expect(await getMember(id)).toMatchObject({ status: 'pending', approved_at: null, expires_at: null });
    expect(await getHistory(id)).toEqual([]);
  });

  it('answers 404 for an unknown member even with a role assignment', async () => {
    expect((await put(987_654, { status: 'president' })).status).toBe(404);
  });
});

describe('POST /api/admin/members/batch - dates and history', () => {
  it('does not reset the approval of members who are already active', async () => {
    const already = await insertMember({ status: 'active', approved_at: '2024-01-01 00:00:00', expires_at: '2024-08-31' });
    const honor = await insertMember({ status: 'honor', approved_at: '2023-01-01 00:00:00', expires_at: '2023-08-31' });
    const pending = await insertMember({ status: 'pending' });

    expect((await batch({ memberIds: [already, honor, pending], status: 'active' })).status).toBe(200);

    expect(await getMember(already)).toMatchObject({ status: 'active', approved_at: '2024-01-01 00:00:00', expires_at: '2024-08-31' });
    expect(await getMember(honor)).toMatchObject({ status: 'active', approved_at: '2023-01-01 00:00:00', expires_at: '2023-08-31' });
    const fresh = await getMember(pending);
    expect(fresh.approved_at).toMatch(SQL_TIMESTAMP);
    expect(fresh.expires_at).toBe(expectedExpiry());
  });

  it('reapproves expired and rejected members', async () => {
    const expired = await insertMember({ status: 'expired', approved_at: '2020-01-01 00:00:00', expires_at: '2020-08-31' });
    await batch({ memberIds: [expired], status: 'active' });
    expect((await getMember(expired)).expires_at).toBe(expectedExpiry());
  });

  it('records the previous status in the history and skips members whose status does not change', async () => {
    const pending = await insertMember({ status: 'pending' });
    const active = await insertMember({ status: 'active' });

    const response = await batch({ memberIds: [pending, active], status: 'active', reason: 'Bulk' });

    expect(response.status).toBe(200);
    expect(await getHistory(pending)).toMatchObject([{ old_status: 'pending', new_status: 'active', reason: 'Bulk' }]);
    expect(await getHistory(active)).toEqual([]);
  });

  it('answers 400 for a reason over 1000 characters', async () => {
    const id = await insertMember();
    expect((await batch({ memberIds: [id], status: 'active', reason: 'r'.repeat(1001) })).status).toBe(400);
  });
});

describe('DELETE /api/admin/members/batch', () => {
  const delBatch = (body) => adminFetch('/api/admin/members/batch', { method: 'DELETE', body });

  it('deletes the listed members, cascades their history and reports the count', async () => {
    const a = await insertMember({ status: 'pending' });
    const b = await insertMember({ status: 'pending' });
    const keep = await insertMember();
    await batch({ memberIds: [a, b], status: 'active' });
    expect(await getHistory(a)).toHaveLength(1);

    const response = await delBatch({ ids: [a, b] });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, deleted: 2 });
    expect(await getMember(a)).toBeNull();
    expect(await getMember(b)).toBeNull();
    expect(await getMember(keep)).not.toBeNull();
    expect(await getHistory(a)).toEqual([]);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM membership_history').first()).n).toBe(0);
  });

  it('ignores duplicate ids and ids that do not exist', async () => {
    const id = await insertMember();
    const response = await delBatch({ ids: [id, id, 987_654] });
    expect(response.status).toBe(200);
    expect((await response.json()).deleted).toBe(1);
  });

  it('deletes more ids than one D1 statement can bind (250 members, one request)', async () => {
    const ids = [];
    for (let i = 0; i < 250; i++) ids.push(await insertMember());
    const keep = await insertMember();

    const response = await delBatch({ ids });

    expect((await response.json()).deleted).toBe(250);
    expect(await countMembers()).toBe(1);
    expect(await getMember(keep)).not.toBeNull();
  }, 30_000);

  it('answers 404 when none of the ids exist', async () => {
    expect((await delBatch({ ids: [987_654] })).status).toBe(404);
  });

  it('accepts exactly 1000 ids and rejects 1001 with too_many_ids', async () => {
    const ids = Array.from({ length: 1001 }, (_, i) => i + 1_000_000);
    expect((await delBatch({ ids: ids.slice(0, 1000) })).status).toBe(404);
    const response = await delBatch({ ids });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'too_many_ids' });
  });

  it.each([
    ['missing', {}, 'no_members'],
    ['an empty array', { ids: [] }, 'no_members'],
    ['a string', { ids: '1,2' }, 'no_members'],
    ['a non-id entry', { ids: [1, 'x'] }, 'invalid_id'],
    ['zero', { ids: [0] }, 'invalid_id'],
    ['a float', { ids: [1.5] }, 'invalid_id'],
    ['a nested array', { ids: [[1]] }, 'invalid_id']
  ])('rejects ids that are %s and deletes nothing', async (_label, body, code) => {
    await insertMember();
    const response = await delBatch(body);
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe(code);
    expect(await countMembers()).toBe(1);
  });

  it.each(['{oops', '', 'null', '[1]'])('answers 400 invalid_body for the body %j', async (body) => {
    const response = await delBatch(body);
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('invalid_body');
  });
});
