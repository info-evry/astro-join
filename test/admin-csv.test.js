/**
 * CSV export (formatting, injection safety) and CSV import (parsing,
 * validation, upserts, history), including an export -> import round trip.
 *
 * The export is `;`-separated with a UTF-8 BOM (Excel FR); the import accepts
 * `,` `;` and TAB, the old comma exports and the new ones.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { setupSchema, resetMembers, insertMember, getMember, getHistory, adminFetch, uid } from './helpers.js';

beforeAll(setupSchema);
beforeEach(resetMembers);

const exportCsv = (query = '') => adminFetch(`/api/admin/export${query}`);
const importCsv = (csv) => adminFetch('/api/admin/import', { method: 'POST', body: { csv } });
const byEmail = (email) => env.DB.prepare('SELECT * FROM members WHERE email = ?').bind(email).first();

const BOM = '\uFEFF';

/**
 * Minimal RFC 4180 reader used to check the exporter's output independently of
 * astro-core's parser: a cell is a quoted run (with "" escapes) or plain text,
 * followed by a delimiter, a line break or the end of the text.
 */
function readCsv(text, delimiter = ';') {
  const source = text.startsWith(BOM) ? text.slice(1) : text;
  const cell = new RegExp(String.raw`("(?:[^"]|"")*"|[^${delimiter}\r\n"]*)(${delimiter}|\r\n|\n|$)`, 'y');
  const rows = [];
  let row = [];
  let index = 0;
  let finished = source === '';
  while (!finished) {
    cell.lastIndex = index;
    const match = cell.exec(source);
    if (!match) throw new Error(`Unreadable CSV at offset ${index}`);
    const [, raw, end] = match;
    row.push(raw.startsWith('"') ? raw.slice(1, -1).replaceAll('""', '"') : raw);
    index = cell.lastIndex;
    if (end !== delimiter) {
      rows.push(row);
      row = [];
      // a final line break does not start another row
      finished = index >= source.length;
    }
  }
  return rows;
}

const HEADERS = [
  'ID', 'Prénom', 'Nom', 'Email', 'Numéro étudiant', 'Numéro inscription', 'Cursus', 'Téléphone',
  'Telegram', 'Discord', 'Statut', 'Notes', 'Date adhésion', 'Date approbation', 'Date expiration'
];

describe('GET /api/admin/export', () => {
  it('serves a CSV attachment: UTF-8 BOM, semicolon separated, expected headers row', async () => {
    const response = await exportCsv();
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/csv; charset=utf-8');
    expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="members.csv"');
    // Response.text() drops a leading BOM, so check the bytes
    const bytes = new Uint8Array(await response.clone().arrayBuffer());
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
    expect((await response.text()).split('\r\n')[0]).toBe(HEADERS.join(';'));
  });

  it('exports only the header row when there are no members', async () => {
    expect(await (await exportCsv()).text()).toBe(HEADERS.join(';'));
  });

  it('separates cells with semicolons and quotes only the cells that need it', async () => {
    await insertMember({
      first_name: 'Ada', last_name: 'Lovelace', email: 'ada@test.example', student_id: 'S1',
      enrollment_number: 'EN-7', phone: '+33612345678', telegram: '@ada', discord: 'ada;1', status: 'active'
    });

    const lines = (await (await exportCsv()).text()).split('\r\n');

    expect(lines).toHaveLength(2);
    const row = readCsv(lines[1])[0];
    expect(row).toHaveLength(HEADERS.length);
    expect(row.slice(1, 11)).toEqual([
      'Ada', 'Lovelace', 'ada@test.example', 'S1', 'EN-7', 'L3 Informatique',
      // phone numbers are not apostrophe-prefixed, '@' handles are
      '+33612345678', "'@ada", 'ada;1', 'active'
    ]);
    expect(lines[1]).toContain(';"ada;1";');
    expect(lines[1]).not.toContain('"Ada"');
  });

  it('exports enrollment_number', async () => {
    await insertMember({ enrollment_number: '20240042' });
    expect(readCsv(await (await exportCsv()).text())[1][5]).toBe('20240042');
  });

  it('writes empty strings (not "null") for missing optional values', async () => {
    await insertMember({ discord: null, status: 'pending' });
    const rows = readCsv(await (await exportCsv()).text());
    const row = rows[1];
    expect(Number(row[0])).toBeGreaterThan(0);
    // student id, enrollment number, phone, telegram, discord, notes, approval date, expiry date
    expect([row[4], row[5], row[7], row[8], row[9], row[11], row[13], row[14]]).toEqual(Array.from({ length: 8 }, () => ''));
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

  it('filters on every bureau role with status=bureau (the dashboard filter)', async () => {
    await insertMember({ status: 'president', last_name: 'Boss' });
    await insertMember({ status: 'honorary_president', last_name: 'Honorary' });
    await insertMember({ status: 'active', last_name: 'Plain' });

    const response = await exportCsv('?status=bureau');
    const rows = readCsv(await response.text()).slice(1);

    expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="members_bureau.csv"');
    expect(rows.map((row) => row[2]).sort()).toEqual(['Boss', 'Honorary']);
  });

  it('treats an empty status filter as no filter', async () => {
    await insertMember({ status: 'active' });
    await insertMember({ status: 'pending' });
    expect(readCsv(await (await exportCsv('?status=')).text())).toHaveLength(3);
  });

  it.each([
    ['an unknown status', 'superuser'],
    ['a different case', 'Active'],
    ['SQL', encodeURIComponent("active' OR '1'='1")],
    ['CRLF injection', '%0d%0aSet-Cookie:x=1'],
    ['a quote', 'a%22b'],
    ['a path separator', '..%2F..%2Fetc'],
    ['a prototype key', '__proto__']
  ])('rejects %s in the status filter with 400 invalid_status', async (_label, status) => {
    await insertMember({ status: 'active' });
    const response = await exportCsv(`?status=${status}`);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'invalid_status' });
    expect(response.headers.get('Content-Disposition')).toBeNull();
    expect(response.headers.get('Set-Cookie')).toBeNull();
  });

  it('doubles embedded quotes and keeps embedded delimiters and newlines inside quotes', async () => {
    const id = await insertMember({
      first_name: 'Say "hi"; please', last_name: 'Line1\nLine2', email: `${uid('q')}@test.example`
    });

    const rows = readCsv(await (await exportCsv()).text());

    expect(rows).toHaveLength(2);
    expect(rows[1][0]).toBe(String(id));
    expect(rows[1][1]).toBe('Say "hi"; please');
    expect(rows[1][2]).toBe('Line1\nLine2');
  });

  describe('formula injection', () => {
    it.each(['=', '+', '-', '@', '\t', '\r', '|'])(
      'prefixes a value starting with %j with an apostrophe',
      async (prefix) => {
        await insertMember({ first_name: `${prefix}CMD|' /C calc'!A0`, last_name: 'Safe' });
        const rows = readCsv(await (await exportCsv()).text());
        expect(rows[1][1]).toBe(`'${prefix}CMD|' /C calc'!A0`);
        expect(rows[1][1][0]).toBe("'");
      }
    );

    it('quotes (and does not prefix) a value starting with the delimiter', async () => {
      await insertMember({ first_name: ';x', last_name: 'Safe' });
      expect(readCsv(await (await exportCsv()).text())[1][1]).toBe(';x');
    });

    it('neutralises a classic payload in every text column, but keeps phone numbers intact', async () => {
      const payload = '=HYPERLINK("http://evil.example","x")';
      await insertMember({
        first_name: payload, last_name: payload, email: `${uid('f')}@test.example`,
        student_id: payload, enrollment_track: payload, phone: '+33612345678',
        telegram: payload, discord: '@cmd', notes: payload
      });

      const [, row] = readCsv(await (await exportCsv()).text());

      expect([row[1], row[2], row[4], row[6], row[8], row[11]]).toEqual(Array.from({ length: 6 }, () => `'${payload}`));
      expect(row[7]).toBe('+33612345678');
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
    expect(await response.json()).toMatchObject({ code: 'csv_required' });
  });

  it.each([
    ['malformed JSON', '{oops'],
    ['an empty body', ''],
    ['JSON null', 'null'],
    ['a JSON array', '[]']
  ])('answers 400 invalid_body (not 500) for %s', async (_label, body) => {
    const response = await adminFetch('/api/admin/import', { method: 'POST', body });
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('invalid_body');
  });

  it.each([
    ['header only', 'Prénom,Nom,Email'],
    ['header and trailing blank lines', 'Prénom,Nom,Email\n\n  \n'],
    ['only whitespace after BOM', '﻿Prénom,Nom,Email\r\n']
  ])('requires a data row (%s)', async (_label, csv) => {
    const response = await importCsv(csv);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'invalid_csv' });
  });

  it.each([
    ['no email column', 'Prénom,Nom\nA,B'],
    ['no first name column', 'Nom,Email\nA,a@test.example'],
    ['no last name column', 'Prénom,Email\nA,a@test.example'],
    ['unrelated columns', 'a,b,c\n1,2,3']
  ])('requires the Prénom, Nom and Email columns (%s)', async (_label, csv) => {
    const response = await importCsv(csv);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'missing_columns' });
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
    ['empty first name', ',Doe,a@test.example', 'champs obligatoires manquants (prénom, nom, email)'],
    ['empty last name', 'John,,a@test.example', 'champs obligatoires manquants (prénom, nom, email)'],
    ['empty email', 'John,Doe,', 'champs obligatoires manquants (prénom, nom, email)'],
    ['an email without @', 'John,Doe,nope', 'email invalide'],
    ['an email with a space', 'John,Doe,"a b@test.example"', 'email invalide'],
    ['an email without a domain dot', 'John,Doe,a@nodot', 'email invalide'],
    ['an unknown status label', 'John,Doe,a@test.example,Chef suprême', 'statut inconnu « Chef suprême »'],
    ['a name over 100 characters', `${'x'.repeat(101)},Doe,a@test.example`, 'prénom trop long (100 caractères maximum)']
  ])('skips and reports a row with %s', async (_label, row, message) => {
    const response = await importCsv(`Prénom,Nom,Email,Statut\n${row}`);
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.stats).toEqual({ imported: 0, updated: 0, skipped: 1, total: 1 });
    expect(data.errors).toEqual([`Ligne 2 : ${message}`]);
  });

  it('reports the record number of each bad row and still imports the good ones', async () => {
    const csv = 'Prénom,Nom,Email\nOk,One,ok1@test.example\nBad,Two,bad\nOk,Three,ok3@test.example\n,Four,four@test.example';
    const data = await (await importCsv(csv)).json();
    expect(data.stats).toEqual({ imported: 2, updated: 0, skipped: 2, total: 4 });
    expect(data.errors).toEqual([
      'Ligne 3 : email invalide',
      'Ligne 5 : champs obligatoires manquants (prénom, nom, email)'
    ]);
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
      expect(data.errors[0]).toContain('déjà attribué dans cet import');
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
  /** The fields an import restores (dates are re-derived from the status, ids are new). */
  const RESTORED = [
    'first_name', 'last_name', 'email', 'student_id', 'enrollment_number', 'enrollment_track',
    'phone', 'telegram', 'discord', 'status', 'notes'
  ];
  const restored = (row) => Object.fromEntries(RESTORED.map((column) => [column, row[column]]));

  const people = [
    { first_name: 'Ada', last_name: 'Lovelace', email: 'ada-rt@test.example', student_id: 'S1', enrollment_number: '20240001', phone: '+33612345678', enrollment_track: 'M1 Informatique', status: 'active' },
    { first_name: 'Grace', last_name: 'Hopper, "Amazing"', email: 'grace-rt@test.example', student_id: null, phone: '06 12 34 56 78', enrollment_track: 'Doctorat, Info', status: 'treasurer', notes: 'Line one\nLine two; with "quotes"' },
    { first_name: 'Zoë', last_name: 'Éluard-Müller', email: 'zoe-rt@test.example', telegram: '@zoe', discord: 'zoe#1234', enrollment_track: 'L3 Informatique', status: 'honor' },
    { first_name: '=cmd', last_name: '-dash', email: 'inj-rt@test.example', phone: '(01) 23.45', notes: '=HYPERLINK("http://evil.example","x")', enrollment_track: 'L1 Informatique', status: 'pending' },
    { first_name: "'=quoted", last_name: "'+plain", email: 'apos-rt@test.example', notes: "'@mention and |pipe", enrollment_track: 'Autre', status: 'rejected' },
    { first_name: 'Linus', last_name: 'Torvalds', email: 'linus-rt@test.example', student_id: 'S3', phone: '0103', enrollment_track: 'L3 Informatique', status: 'expired', notes: '+33 notes' }
  ];

  it('re-imports an export into an empty database with equivalent members', async () => {
    for (const person of people) await insertMember(person);
    const before = await env.DB.prepare('SELECT * FROM members ORDER BY email').all();

    const exported = await (await exportCsv()).text();
    await resetMembers();
    const data = await (await importCsv(exported)).json();

    expect(data.stats).toMatchObject({ imported: people.length, updated: 0, skipped: 0 });
    expect(data.errors).toBeUndefined();
    const after = await env.DB.prepare('SELECT * FROM members ORDER BY email').all();
    expect(after.results.map(restored)).toEqual(before.results.map(restored));
  });

  it('also round-trips the previous comma/quote-everything export format', async () => {
    // (the old exporter did not double a leading apostrophe, so fixtures starting with one are ambiguous there)
    for (const person of people.filter((p) => !p.first_name.startsWith("'"))) await insertMember(person);
    const before = await env.DB.prepare('SELECT * FROM members ORDER BY email').all();

    // The format the exporter used before: commas, every cell quoted, apostrophe before = + - @ | and phones
    const rows = before.results.map((member) => [
      member.id, member.first_name, member.last_name, member.email, member.student_id || '', member.enrollment_track,
      member.phone || '', member.telegram || '', member.discord || '', member.status, member.created_at, '', ''
    ].map((value) => {
      let text = String(value).replaceAll('"', '""');
      if (/^[=+\-@\t\r|;]/.test(text)) text = `'${text}`;
      return `"${text}"`;
    }).join(','));
    const legacy = ['ID,Prénom,Nom,Email,Numéro étudiant,Cursus,Téléphone,Telegram,Discord,Statut,Date adhésion,Date approbation,Date expiration', ...rows].join('\n');

    await resetMembers();
    const data = await (await importCsv(legacy)).json();

    expect(data.stats).toMatchObject({ imported: people.length - 1, skipped: 0 });
    const after = await env.DB.prepare('SELECT * FROM members ORDER BY email').all();
    // The old format had no enrollment number nor notes columns
    const withoutLost = (row) => ({ ...restored(row), enrollment_number: null, notes: null });
    expect(after.results.map(restored)).toEqual(before.results.map(withoutLost));
  });

  it('re-imports an export over existing data as pure updates that change nothing', async () => {
    for (const person of people) await insertMember(person);
    const before = await env.DB.prepare('SELECT * FROM members ORDER BY email').all();
    const exported = await (await exportCsv()).text();

    const data = await (await importCsv(exported)).json();

    expect(data.stats).toMatchObject({ imported: 0, updated: people.length, skipped: 0 });
    const after = await env.DB.prepare('SELECT * FROM members ORDER BY email').all();
    expect(after.results.map(restored)).toEqual(before.results.map(restored));
  });
});

describe('POST /api/admin/import - formats and fields', () => {
  it.each([
    ['comma', ','],
    ['semicolon', ';'],
    ['tab', '\t']
  ])('reads %s separated files with the same result', async (_label, d) => {
    const email = `${uid('sep')}@test.example`;
    const csv = ['Prénom', 'Nom', 'Email', 'Téléphone', 'Notes'].join(d) + '\n' +
      ['Sep', 'Arator', email, '+33612345678', 'a note'].join(d);
    expect((await (await importCsv(csv)).json()).stats.imported).toBe(1);
    expect(await byEmail(email)).toMatchObject({ phone: '+33612345678', notes: 'a note' });
  });

  it('removes the injection guard from cells (apostrophe before = + - @ |)', async () => {
    await importCsv('Prénom;Nom;Email;Telegram;Discord;Notes\n\'=A;\'-B;guard@test.example;\'@tg;\'|dc;\'+n');
    expect(await byEmail('guard@test.example')).toMatchObject({
      first_name: '=A', last_name: '-B', telegram: '@tg', discord: '|dc', notes: '+n'
    });
  });

  it('keeps an apostrophe that is not an injection guard', async () => {
    await importCsv("Prénom;Nom;Email\nD'Arc;O'Neil;apos@test.example");
    expect(await byEmail('apos@test.example')).toMatchObject({ first_name: "D'Arc", last_name: "O'Neil" });
  });

  it.each(['Numéro inscription', "Numéro d'inscription", 'enrollment_number', 'N° inscription'])(
    'imports the enrollment number from the %j column',
    async (header) => {
      const email = `${uid('en')}@test.example`;
      await importCsv(`Prénom;Nom;Email;${header}\nEn;Roll;${email};20240042`);
      expect((await byEmail(email)).enrollment_number).toBe('20240042');
    }
  );

  it('imports Telegram, Discord and notes', async () => {
    await importCsv('Prénom;Nom;Email;Telegram;Discord;Notes\nTe;Le;tele@test.example;@te;le#1;remarque');
    expect(await byEmail('tele@test.example')).toMatchObject({ telegram: '@te', discord: 'le#1', notes: 'remarque' });
  });

  it('reports an unknown status label as a row error instead of making the member active', async () => {
    const id = await insertMember({ email: 'known@test.example', status: 'pending' });

    const data = await (await importCsv(
      'Prénom,Nom,Email,Statut\nNew,Person,new-unk@test.example,Chef suprême\nKnown,Person,known@test.example,???\nOk,Person,ok-unk@test.example,actif'
    )).json();

    expect(data.stats).toEqual({ imported: 1, updated: 0, skipped: 2, total: 3 });
    expect(data.errors).toEqual(['Ligne 2 : statut inconnu « Chef suprême »', 'Ligne 3 : statut inconnu « ??? »']);
    expect(await byEmail('new-unk@test.example')).toBeNull();
    expect((await getMember(id)).status).toBe('pending');
    expect((await byEmail('ok-unk@test.example')).status).toBe('active');
  });

  it('refuses more than 2000 data rows with 400 too_many_rows and writes nothing', async () => {
    const rows = Array.from({ length: 2001 }, (_, i) => `R,${i},row${i}@test.example`);
    const response = await importCsv(`Prénom,Nom,Email\n${rows.join('\n')}`);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'too_many_rows' });
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM members').first()).n).toBe(0);
  });

  it('imports exactly 2000 rows', async () => {
    const rows = Array.from({ length: 2000 }, (_, i) => `R,${i},row${i}@test.example,pending`);
    const data = await (await importCsv(`Prénom,Nom,Email,Statut\n${rows.join('\n')}`)).json();
    expect(data.stats).toMatchObject({ imported: 2000, skipped: 0 });
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM members').first()).n).toBe(2000);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM membership_history').first()).n).toBe(2000);
  }, 60_000);

  it('imports files spanning several write batches and reports row errors in place', async () => {
    const rows = Array.from({ length: 60 }, (_, i) => (i === 30 ? 'Bad,Row,nope' : `R,${i},multi${i}@test.example`));
    const data = await (await importCsv(`Prénom,Nom,Email\n${rows.join('\n')}`)).json();
    expect(data.stats).toEqual({ imported: 59, updated: 0, skipped: 1, total: 60 });
    expect(data.errors).toEqual(['Ligne 32 : email invalide']);
  });

  it('isolates the failing row when a batch is rolled back and never leaks the database message', async () => {
    await env.DB.prepare(
      "CREATE TRIGGER IF NOT EXISTS fail_boom BEFORE INSERT ON members WHEN NEW.email = 'boom@test.example' BEGIN SELECT RAISE(ABORT, 'secret internal detail'); END"
    ).run();
    try {
      const data = await (await importCsv(
        'Prénom,Nom,Email\nA,One,a-boom@test.example\nBoom,Two,boom@test.example\nC,Three,c-boom@test.example'
      )).json();

      expect(data.stats).toEqual({ imported: 2, updated: 0, skipped: 1, total: 3 });
      expect(data.errors).toEqual(['Ligne 3 : enregistrement impossible']);
      expect(JSON.stringify(data)).not.toContain('secret');
      expect(await byEmail('a-boom@test.example')).not.toBeNull();
      expect(await byEmail('boom@test.example')).toBeNull();
      expect(await byEmail('c-boom@test.example')).not.toBeNull();
    } finally {
      await env.DB.prepare('DROP TRIGGER fail_boom').run();
    }
  });
});

describe('POST /api/admin/import - approval dates and history', () => {
  const expiry = (date) => {
    const year = date.getUTCMonth() >= 8 ? date.getUTCFullYear() + 1 : date.getUTCFullYear();
    return `${year}-08-31`;
  };

  it('approves and logs a created active member, and logs a created pending one', async () => {
    await importCsv('Prénom,Nom,Email,Statut\nAc,Tive,hist-act@test.example,actif\nPe,Nding,hist-pen@test.example,en attente');

    const active = await byEmail('hist-act@test.example');
    expect(active.approved_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(active.expires_at).toBe(expiry(new Date()));
    expect(await getHistory(active.id)).toMatchObject([{ old_status: null, new_status: 'active', reason: 'Imported from CSV' }]);

    const pending = await byEmail('hist-pen@test.example');
    expect([pending.approved_at, pending.expires_at]).toEqual([null, null]);
    expect(await getHistory(pending.id)).toMatchObject([{ old_status: null, new_status: 'pending' }]);
  });

  it('gives bureau and honor members approval dates, but not expired ones', async () => {
    await importCsv('Prénom,Nom,Email,Statut\nB,B,hd-bureau@test.example,Président\nH,H,hd-honor@test.example,honneur\nE,E,hd-exp@test.example,expiré');
    expect((await byEmail('hd-bureau@test.example')).expires_at).toBe(expiry(new Date()));
    expect((await byEmail('hd-honor@test.example')).expires_at).toBe(expiry(new Date()));
    expect((await byEmail('hd-exp@test.example')).expires_at).toBeNull();
  });

  it('approves an existing member who becomes active and logs the transition', async () => {
    const id = await insertMember({ email: 'hist-up@test.example', status: 'pending' });

    await importCsv('Prénom,Nom,Email,Statut\nUp,Date,hist-up@test.example,actif');

    const row = await getMember(id);
    expect(row.status).toBe('active');
    expect(row.approved_at).not.toBeNull();
    expect(row.expires_at).toBe(expiry(new Date()));
    expect(await getHistory(id)).toMatchObject([{ old_status: 'pending', new_status: 'active', reason: 'Imported from CSV' }]);
  });

  it('keeps the dates of a member moving between active statuses and logs only real changes', async () => {
    const id = await insertMember({
      email: 'hist-keep@test.example', status: 'active', approved_at: '2025-01-01 00:00:00', expires_at: '2025-08-31'
    });

    await importCsv('Prénom,Nom,Email,Statut\nKe,Ep,hist-keep@test.example,honneur');
    expect(await getMember(id)).toMatchObject({ status: 'honor', approved_at: '2025-01-01 00:00:00', expires_at: '2025-08-31' });

    await importCsv('Prénom,Nom,Email,Statut\nKe,Ep,hist-keep@test.example,honneur\nKe,Ep,hist-keep@test.example');
    expect(await getHistory(id)).toMatchObject([{ old_status: 'active', new_status: 'honor' }]);
  });

  it('tracks the status through repeated rows of one file', async () => {
    await importCsv('Prénom,Nom,Email,Statut\nA,B,hist-twice@test.example,en attente\nA,B,hist-twice@test.example,actif');
    const row = await byEmail('hist-twice@test.example');
    expect(row.status).toBe('active');
    expect(row.expires_at).toBe(expiry(new Date()));
    expect((await getHistory(row.id)).map((h) => [h.old_status, h.new_status])).toEqual([[null, 'pending'], ['pending', 'active']]);
  });
});
