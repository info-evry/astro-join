/**
 * CSV export (formatting, injection safety) and CSV import (parsing,
 * validation, upserts), including an export -> import round trip.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { setupSchema, resetMembers, insertMember, getMember, adminFetch, uid } from './helpers.js';

beforeAll(setupSchema);
beforeEach(resetMembers);

const exportCsv = (query = '') => adminFetch(`/api/admin/export${query}`);
const importCsv = (csv) => adminFetch('/api/admin/import', { method: 'POST', body: { csv } });
const byEmail = (email) => env.DB.prepare('SELECT * FROM members WHERE email = ?').bind(email).first();

/** Minimal RFC 4180 reader used to check the exporter's output independently. */
function readCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  let skipNext = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (skipNext) {
      skipNext = false;
    } else if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        skipNext = true;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell || row.length > 0) { row.push(cell); rows.push(row); }
  return rows;
}

const HEADERS = [
  'ID', 'Prénom', 'Nom', 'Email', 'Numéro étudiant', 'Cursus', 'Téléphone',
  'Telegram', 'Discord', 'Statut', 'Date adhésion', 'Date approbation', 'Date expiration'
];

describe('GET /api/admin/export', () => {
  it('serves a CSV attachment with the expected headers row', async () => {
    const response = await exportCsv();
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/csv; charset=utf-8');
    expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="members.csv"');
    expect((await response.text()).split('\n')[0]).toBe(HEADERS.join(','));
  });

  it('exports only the header row when there are no members', async () => {
    expect(await (await exportCsv()).text()).toBe(HEADERS.join(','));
  });

  it('quotes every value and uses commas as separators', async () => {
    await insertMember({
      first_name: 'Ada', last_name: 'Lovelace', email: 'ada@test.example', student_id: 'S1',
      phone: '0102', telegram: '@ada', discord: '@ada#1', status: 'active'
    });

    const lines = (await (await exportCsv()).text()).split('\n');

    expect(lines).toHaveLength(2);
    const cells = lines[1].match(/"(?:[^"]|"")*"/g);
    expect(cells).toHaveLength(HEADERS.length);
    expect(lines[1]).toBe(cells.join(','));
    expect(cells.slice(1, 10)).toEqual([
      '"Ada"', '"Lovelace"', '"ada@test.example"', '"S1"', '"L3 Informatique"',
      // '@' is a formula trigger, so handles are apostrophe-prefixed like any other trigger
      '"0102"', `"'@ada"`, `"'@ada#1"`, '"active"'
    ]);
  });

  it('writes empty strings (not "null") for missing optional values', async () => {
    await insertMember({ discord: null, status: 'pending' });
    const rows = readCsv(await (await exportCsv()).text());
    const row = rows[1];
    expect(Number(row[0])).toBeGreaterThan(0);
    // student id, phone, telegram, discord, approval date, expiry date
    expect([row[4], row[6], row[7], row[8], row[11], row[12]]).toEqual(['', '', '', '', '', '']);
  });

  it('orders rows by last name then first name', async () => {
    await insertMember({ first_name: 'Zed', last_name: 'Alpha' });
    await insertMember({ first_name: 'Amy', last_name: 'Beta' });
    await insertMember({ first_name: 'Abe', last_name: 'Alpha' });

    const rows = readCsv(await (await exportCsv()).text()).slice(1);

    expect(rows.map((r) => `${r[2]} ${r[1]}`)).toEqual(['Alpha Abe', 'Alpha Zed', 'Beta Amy']);
  });

  it('filters by status and names the file accordingly', async () => {
    await insertMember({ status: 'active', last_name: 'Keep' });
    await insertMember({ status: 'pending', last_name: 'Drop' });

    const response = await exportCsv('?status=active');
    const rows = readCsv(await response.text()).slice(1);

    expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="members_active.csv"');
    expect(rows).toHaveLength(1);
    expect(rows[0][2]).toBe('Keep');
  });

  it('treats an empty status filter as no filter', async () => {
    await insertMember({ status: 'active' });
    await insertMember({ status: 'pending' });
    expect(readCsv(await (await exportCsv('?status=')).text())).toHaveLength(3);
  });

  it('treats the status filter as data, not SQL', async () => {
    await insertMember({ status: 'active' });
    const response = await exportCsv(`?status=${encodeURIComponent("active' OR '1'='1")}`);
    expect(response.status).toBe(200);
    expect(readCsv(await response.text())).toHaveLength(1);
  });

  it.each([
    ['CRLF injection', '%0d%0aSet-Cookie:x=1'],
    ['a quote', 'a%22b'],
    ['a path separator', '..%2F..%2Fetc']
  ])('cannot break the Content-Disposition header via %s in the status filter', async (_label, status) => {
    const response = await exportCsv(`?status=${status}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Disposition')).toMatch(/^attachment; filename="members_\w+\.csv"$/);
    expect(response.headers.get('Set-Cookie')).toBeNull();
  });

  it('doubles embedded quotes and keeps embedded commas and newlines inside quotes', async () => {
    const id = await insertMember({
      first_name: 'Say "hi", please', last_name: 'Line1\nLine2', email: `${uid('q')}@test.example`
    });

    const rows = readCsv(await (await exportCsv()).text());

    expect(rows).toHaveLength(2);
    expect(rows[1][0]).toBe(String(id));
    expect(rows[1][1]).toBe('Say "hi", please');
    expect(rows[1][2]).toBe('Line1\nLine2');
  });

  describe('formula injection', () => {
    it.each(['=', '+', '-', '@', '\t', '\r', '|', ';'])(
      'prefixes a value starting with %j with an apostrophe',
      async (prefix) => {
        await insertMember({ first_name: `${prefix}CMD|' /C calc'!A0`, last_name: 'Safe' });
        const rows = readCsv(await (await exportCsv()).text());
        expect(rows[1][1]).toBe(`'${prefix}CMD|' /C calc'!A0`);
        expect(rows[1][1][0]).toBe("'");
      }
    );

    it('neutralises a classic payload in every text column', async () => {
      const payload = '=HYPERLINK("http://evil.example","x")';
      await insertMember({
        first_name: payload, last_name: payload, email: `${uid('f')}@test.example`,
        student_id: payload, enrollment_track: payload, phone: '+33612345678',
        telegram: payload, discord: '@cmd'
      });

      const [, row] = readCsv(await (await exportCsv()).text());

      expect([row[1], row[2], row[4], row[5], row[7]]).toEqual(Array.from({ length: 5 }, () => `'${payload}`));
      expect(row[6]).toBe("'+33612345678");
    });

    it('leaves harmless values untouched, including a dash or equals sign in the middle', async () => {
      await insertMember({ first_name: 'Jean-Pierre', last_name: 'a=b', email: 'jp@test.example' });
      const [, row] = readCsv(await (await exportCsv()).text());
      expect(row[1]).toBe('Jean-Pierre');
      expect(row[2]).toBe('a=b');
    });
  });

  it('exports unicode values intact', async () => {
    await insertMember({ first_name: 'Zoë', last_name: '中文 😀', email: 'zo@test.example' });
    const [, row] = readCsv(await (await exportCsv()).text());
    expect([row[1], row[2]]).toEqual(['Zoë', '中文 😀']);
  });
});

describe('POST /api/admin/import - request validation', () => {
  it.each([
    ['missing', undefined],
    ['null', null],
    ['an empty string', ''],
    ['a number', 12],
    ['an array', ['a,b']],
    ['an object', { a: 1 }]
  ])('requires csv to be a non-empty string (%s)', async (_label, csv) => {
    const response = await adminFetch('/api/admin/import', { method: 'POST', body: { csv } });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('required');
  });

  it.each([
    ['malformed JSON', '{oops'],
    ['an empty body', ''],
    ['JSON null', 'null'],
    ['a JSON array', '[]']
  ])('answers 400 (not 500) for %s', async (_label, body) => {
    const response = await adminFetch('/api/admin/import', { method: 'POST', body });
    expect(response.status).toBe(400);
  });

  it.each([
    ['header only', 'Prénom,Nom,Email'],
    ['header and trailing blank lines', 'Prénom,Nom,Email\n\n  \n'],
    ['only whitespace after BOM', '﻿Prénom,Nom,Email\r\n']
  ])('requires a data row (%s)', async (_label, csv) => {
    const response = await importCsv(csv);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('header');
  });

  it.each([
    ['no email column', 'Prénom,Nom\nA,B'],
    ['no first name column', 'Nom,Email\nA,a@test.example'],
    ['no last name column', 'Prénom,Email\nA,a@test.example'],
    ['unrelated columns', 'a,b,c\n1,2,3']
  ])('requires the Prénom, Nom and Email columns (%s)', async (_label, csv) => {
    const response = await importCsv(csv);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('Prénom');
  });
});

describe('POST /api/admin/import - parsing', () => {
  it('reads quoted cells with embedded delimiters', async () => {
    const response = await importCsv('Prénom,Nom,Email,Cursus\nJean,"Dupont, Jr","jd@test.example","L3, parcours IA"');
    expect((await response.json()).stats.imported).toBe(1);
    expect(await byEmail('jd@test.example')).toMatchObject({ last_name: 'Dupont, Jr', enrollment_track: 'L3, parcours IA' });
  });

  it('reads doubled quotes as literal quotes', async () => {
    await importCsv('Prénom,Nom,Email\n"Jean ""JJ""",Dupont,jj@test.example');
    expect((await byEmail('jj@test.example')).first_name).toBe('Jean "JJ"');
  });

  it('reads newlines embedded in quoted cells as part of the cell', async () => {
    const response = await importCsv('Prénom,Nom,Email\n"Jean\nPaul",Dupont,jp@test.example\nAnne,Martin,anne@test.example');
    const data = await response.json();
    expect(data.stats).toMatchObject({ imported: 2, skipped: 0 });
    expect((await byEmail('jp@test.example')).first_name).toBe('Jean\nPaul');
    expect(await byEmail('anne@test.example')).not.toBeNull();
  });

  it('accepts CRLF line endings', async () => {
    const response = await importCsv('Prénom,Nom,Email\r\nA,One,a1@test.example\r\nB,Two,b2@test.example\r\n');
    expect((await response.json()).stats.imported).toBe(2);
    expect((await byEmail('a1@test.example')).last_name).toBe('One');
  });

  it('accepts bare CR line endings', async () => {
    const response = await importCsv('Prénom,Nom,Email\rA,One,a3@test.example\rB,Two,b3@test.example');
    expect((await response.json()).stats.imported).toBe(2);
  });

  it('ignores a UTF-8 BOM before the first header', async () => {
    const response = await importCsv('﻿Prénom,Nom,Email\nBom,Test,bom@test.example');
    expect(response.status).toBe(200);
    expect((await response.json()).stats.imported).toBe(1);
  });

  it.each([
    ['semicolons', 'Prénom;Nom;Email\nSemi;Colon;semi@test.example', 'semi@test.example'],
    ['tabs', 'Prénom\tNom\tEmail\nTab\tDoe\ttab@test.example', 'tab@test.example']
  ])('accepts %s as separators', async (_label, csv, email) => {
    const response = await importCsv(csv);
    expect(response.status).toBe(200);
    expect(await byEmail(email)).not.toBeNull();
  });

  it('does not let a stray quote inside text swallow the following rows', async () => {
    const response = await importCsv('Prénom,Nom,Email\nJean 5" ,Dupont,stray@test.example\nAnne,Martin,after@test.example');
    expect((await response.json()).stats.imported).toBe(2);
    expect((await byEmail('stray@test.example')).first_name).toBe('Jean 5"');
  });

  it('trims cells, lower-cases emails and skips blank lines', async () => {
    const response = await importCsv('  Prénom , Nom , Email \n\n  Ada ,  Lovelace , ADA@Test.Example \n\n');
    expect((await response.json()).stats.imported).toBe(1);
    expect(await byEmail('ada@test.example')).toMatchObject({ first_name: 'Ada', last_name: 'Lovelace' });
  });

  it('accepts columns in any order, any header case, and ignores unknown columns', async () => {
    const response = await importCsv('EMAIL,whatever,NOM,PRÉNOM\nord@test.example,x,Order,Any');
    expect((await response.json()).stats.imported).toBe(1);
    expect(await byEmail('ord@test.example')).toMatchObject({ first_name: 'Any', last_name: 'Order' });
  });

  it.each([
    ['prénom', 'nom', 'email', 'téléphone', 'numéro étudiant', 'filière d\'inscription', 'statut'],
    ['prenom', 'lastname', 'mail', 'telephone', 'numero etudiant', 'filiere', 'status'],
    ['firstname', 'nom', 'email', 'phone', 'student_id', 'track', 'status'],
    ['prénom', 'nom', 'email', 'tel', 'n° étudiant', 'enrollment_track', 'statut'],
    ['prénom', 'nom', 'email', 'tel', 'numéro', 'cursus', 'statut']
  ])('understands the header aliases %j', async (...headers) => {
    const email = `${uid('alias')}@test.example`;
    const csv = `${headers.join(',')}\nAl,Ias,${email},0600,SID1,Master Z,Trésorier`;

    const response = await importCsv(csv);

    expect((await response.json()).stats.imported).toBe(1);
    expect(await byEmail(email)).toMatchObject({
      phone: '0600', student_id: 'SID1', enrollment_track: 'Master Z', status: 'treasurer'
    });
  });

  it('imports the enrollment_number column into the migrated column', async () => {
    await importCsv('Prénom,Nom,Email,enrollment_number\nEn,Roll,enroll@test.example,20240042');
    expect((await byEmail('enroll@test.example')).enrollment_number).toBe('20240042');
  });

  it.each([
    ['Membre actif', 'active'], ['actif', 'active'], ["Membre d'honneur", 'honor'], ['Honneur', 'honor'],
    ['Secrétaire', 'secretary'], ['secretaire', 'secretary'], ['TRÉSORIER', 'treasurer'], ['tresorier', 'treasurer'],
    ['Président', 'president'], ['president', 'president'], ["Président d'honneur", 'honorary_president'],
    ["president d'honneur", 'honorary_president'], ['Vice-président', 'vice_president'],
    ['vice president', 'vice_president'], ['Vice Président', 'vice_president'],
    ['En attente', 'pending'], ['pending', 'pending'], ['Refusé', 'rejected'], ['refuse', 'rejected'],
    ['Expiré', 'expired'], ['expire', 'expired']
  ])('maps the status label %j to %s', async (label, status) => {
    const email = `${uid('st')}@test.example`;
    await importCsv(`Prénom,Nom,Email,Statut\nS,T,${email},${label}`);
    expect((await byEmail(email)).status).toBe(status);
  });

  it.each([
    'pending', 'active', 'honor', 'secretary', 'treasurer', 'president',
    'honorary_president', 'vice_president', 'rejected', 'expired'
  ])('accepts the internal status value %s written by the export', async (status) => {
    const email = `${uid('int')}@test.example`;
    await importCsv(`Prénom,Nom,Email,Statut\nIn,Ternal,${email},${status}`);
    expect((await byEmail(email)).status).toBe(status);
  });

  it('gives imported members approval dates, except pending and rejected ones', async () => {
    await importCsv('Prénom,Nom,Email,Statut\nA,A,a-act@test.example,actif\nP,P,p-pen@test.example,en attente\nR,R,r-rej@test.example,refusé');
    const active = await byEmail('a-act@test.example');
    expect(active.approved_at).not.toBeNull();
    expect(active.expires_at).toMatch(/^\d{4}-08-31$/);
    for (const email of ['p-pen@test.example', 'r-rej@test.example']) {
      const row = await byEmail(email);
      expect([row.approved_at, row.expires_at]).toEqual([null, null]);
    }
  });

  it('defaults new members to active with the "Autre" track when columns are absent', async () => {
    await importCsv('Prénom,Nom,Email\nDe,Fault,default@test.example');
    expect(await byEmail('default@test.example')).toMatchObject({ status: 'active', enrollment_track: 'Autre' });
  });

  it('stores blank optional cells as NULL', async () => {
    await importCsv('Prénom,Nom,Email,Téléphone,Numéro,Cursus\nBl,Ank,blank@test.example,,  ,');
    expect(await byEmail('blank@test.example')).toMatchObject({
      phone: null, student_id: null, enrollment_track: 'Autre'
    });
  });

  it('keeps hostile text verbatim', async () => {
    const payload = '"""><img src=x onerror=alert(1)>"';
    await importCsv(`Prénom,Nom,Email\n${payload},Xss,xss-imp@test.example`);
    expect((await byEmail('xss-imp@test.example')).first_name).toBe('"><img src=x onerror=alert(1)>');
  });
});

describe('POST /api/admin/import - validation and reporting', () => {
  it.each([
    ['empty first name', ',Doe,a@test.example', 'Missing required fields'],
    ['empty last name', 'John,,a@test.example', 'Missing required fields'],
    ['empty email', 'John,Doe,', 'Missing required fields'],
    ['an email without @', 'John,Doe,nope', 'Invalid email format'],
    ['an email with a space', 'John,Doe,"a b@test.example"', 'Invalid email format'],
    ['an email without a domain dot', 'John,Doe,a@nodot', 'Invalid email format']
  ])('skips and reports a row with %s', async (_label, row, message) => {
    const response = await importCsv(`Prénom,Nom,Email\n${row}`);
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.stats).toEqual({ imported: 0, updated: 0, skipped: 1, total: 1 });
    expect(data.errors).toEqual([`Row 2: ${message}`]);
  });

  it('reports the record number of each bad row and still imports the good ones', async () => {
    const csv = 'Prénom,Nom,Email\nOk,One,ok1@test.example\nBad,Two,bad\nOk,Three,ok3@test.example\n,Four,four@test.example';
    const data = await (await importCsv(csv)).json();
    expect(data.stats).toEqual({ imported: 2, updated: 0, skipped: 2, total: 4 });
    expect(data.errors).toEqual(['Row 3: Invalid email format', 'Row 5: Missing required fields']);
  });

  it('reports at most 10 errors but counts every skipped row', async () => {
    const rows = Array.from({ length: 15 }, (_, i) => `Bad,Row${i},invalid${i}`);
    const data = await (await importCsv(`Prénom,Nom,Email\n${rows.join('\n')}`)).json();
    expect(data.stats.skipped).toBe(15);
    expect(data.errors).toHaveLength(10);
  });

  it('omits the errors key when every row imports cleanly', async () => {
    const data = await (await importCsv('Prénom,Nom,Email\nA,B,clean@test.example')).json();
    expect(data).not.toHaveProperty('errors');
    expect(data.success).toBe(true);
  });

  it('updates an existing member found by email, ignoring email case', async () => {
    const id = await insertMember({
      email: 'exist@test.example', first_name: 'Old', last_name: 'Name', status: 'pending',
      phone: '0100', student_id: 'KEEP', enrollment_track: 'L1 Informatique'
    });

    const data = await (await importCsv("Prénom,Nom,Email,Cursus,Statut\nNew,Person,EXIST@test.example,M2 Informatique,actif")).json();

    expect(data.stats).toMatchObject({ imported: 0, updated: 1, skipped: 0 });
    expect(await getMember(id)).toMatchObject({
      first_name: 'New', last_name: 'Person', status: 'active',
      enrollment_track: 'M2 Informatique', phone: '0100', student_id: 'KEEP'
    });
  });

  it('does not wipe stored values when the CSV cells or columns are blank or missing', async () => {
    const id = await insertMember({
      email: 'keep@test.example', status: 'secretary', phone: '0100', student_id: 'KEEP',
      enrollment_number: 'EN1', enrollment_track: 'M1 Informatique'
    });

    await importCsv('Prénom,Nom,Email,Téléphone,Numéro\nKept,Data,keep@test.example,,');

    expect(await getMember(id)).toMatchObject({
      first_name: 'Kept', phone: '0100', student_id: 'KEEP', enrollment_number: 'EN1',
      enrollment_track: 'M1 Informatique', status: 'secretary'
    });
  });

  it('treats a repeated email inside one file as an insert followed by an update', async () => {
    const data = await (await importCsv('Prénom,Nom,Email\nFirst,Pass,twice@test.example\nSecond,Pass,twice@test.example')).json();
    expect(data.stats).toMatchObject({ imported: 1, updated: 1, skipped: 0 });
    expect((await byEmail('twice@test.example')).first_name).toBe('Second');
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM members').first()).n).toBe(1);
  });

  describe('bureau roles', () => {
    it.each([
      ['president', 'Président'], ['vice_president', 'Vice-président'],
      ['secretary', 'Secrétaire'], ['treasurer', 'Trésorier']
    ])('refuses a second %s already held in the database', async (status, label) => {
      await insertMember({ status, first_name: 'Current', last_name: 'Holder', email: 'holder@test.example' });

      const data = await (await importCsv(`Prénom,Nom,Email,Statut\nNew,One,new@test.example,${label}`)).json();

      expect(data.stats.skipped).toBe(1);
      expect(data.errors[0]).toContain('Current Holder');
      expect(await byEmail('new@test.example')).toBeNull();
    });

    it.each([
      ['president', 'Président'], ['vice_president', 'Vice-président'],
      ['secretary', 'Secrétaire'], ['treasurer', 'Trésorier']
    ])('refuses two %s rows in one file', async (status, label) => {
      const csv = `Prénom,Nom,Email,Statut\nA,One,a-b@test.example,${label}\nB,Two,b-b@test.example,${label}`;
      const data = await (await importCsv(csv)).json();
      expect(data.stats).toMatchObject({ imported: 1, skipped: 1 });
      expect(data.errors[0]).toContain('already assigned in this import');
      expect((await byEmail('a-b@test.example')).status).toBe(status);
      expect(await byEmail('b-b@test.example')).toBeNull();
    });

    it('lets the current holder be re-imported in the same role', async () => {
      await insertMember({ status: 'treasurer', email: 'same@test.example' });
      const data = await (await importCsv('Prénom,Nom,Email,Statut\nSame,Holder,same@test.example,Trésorier')).json();
      expect(data.stats).toMatchObject({ updated: 1, skipped: 0 });
    });

    it('keeps an existing bureau member in place when the status column is absent', async () => {
      await insertMember({ status: 'president', email: 'boss@test.example' });
      await importCsv('Prénom,Nom,Email\nBoss,Renamed,boss@test.example');
      expect((await byEmail('boss@test.example')).status).toBe('president');
    });
  });
});

describe('export -> import round trip', () => {
  it('re-imports an export into an empty database without losing data', async () => {
    const people = [
      { first_name: 'Ada', last_name: 'Lovelace', email: 'ada-rt@test.example', student_id: 'S1', phone: '0102', enrollment_track: 'M1 Informatique', status: 'active' },
      { first_name: 'Grace', last_name: 'Hopper, "Amazing"', email: 'grace-rt@test.example', student_id: null, phone: null, enrollment_track: 'Doctorat, Info', status: 'treasurer' },
      { first_name: 'Linus', last_name: 'Torvalds', email: 'linus-rt@test.example', student_id: 'S3', phone: '0103', enrollment_track: 'L3 Informatique', status: 'expired' }
    ];
    for (const person of people) await insertMember(person);

    const exported = await (await exportCsv()).text();
    await resetMembers();
    const data = await (await importCsv(exported)).json();

    expect(data.stats).toMatchObject({ imported: 3, skipped: 0 });
    for (const person of people) {
      expect(await byEmail(person.email)).toMatchObject({
        first_name: person.first_name, last_name: person.last_name, student_id: person.student_id,
        phone: person.phone, enrollment_track: person.enrollment_track, status: person.status
      });
    }
  });

  it('re-imports an export over existing data as pure updates', async () => {
    await insertMember({ email: 'u1@test.example' });
    await insertMember({ email: 'u2@test.example' });
    const exported = await (await exportCsv()).text();

    const data = await (await importCsv(exported)).json();

    expect(data.stats).toMatchObject({ imported: 0, updated: 2, skipped: 0 });
  });
});
