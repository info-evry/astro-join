/**
 * Property test: hostile input must never produce a 500, on EVERY route
 * registered in src/routes.js, with and without a valid admin token. Every
 * error body must follow the `{ error, code }` contract.
 *
 * Each request uses its own client IP so the rate limiters (5 applications per
 * 10 minutes, 60 admin requests per minute) never hide the handler under test.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { SELF } from 'cloudflare:test';
import { createRouter } from '../src/routes.js';
import { BASE, ADMIN_TOKEN, setupSchema, resetMembers, insertMember } from './helpers.js';

beforeAll(setupSchema);
beforeEach(resetMembers);

// ---------------------------------------------------------------------------
// Routes, derived from the router so a new route is covered automatically
// ---------------------------------------------------------------------------

const ID_PLACEHOLDER = '{id}';

/** `/api/admin/members/{id}` from a compiled route pattern. */
function templateOf(route) {
  return route.pattern.source
    .replace(/^\^/, '')
    .replace(/\$$/, '')
    .replaceAll(String.raw`\/`, '/')
    .replaceAll(/\(\?<\w+>\[\^\/]\+\)/g, ID_PLACEHOLDER);
}

const ROUTES = createRouter().routes.map((route) => ({
  method: route.method,
  template: templateOf(route),
  label: `${route.method} ${templateOf(route)}`
}));

// ---------------------------------------------------------------------------
// Hostile inputs
// ---------------------------------------------------------------------------

const BIG = 'x'.repeat(5 * 1024 * 1024);
const LONG = 'A'.repeat(100_000);
const IDS_5000 = Array.from({ length: 5000 }, (_, i) => i + 1);
const UNICODE = 'Zoë 中文 😀 ‮evil \u0000 \uD800 ﷺ';
const DEEP = '['.repeat(20_000) + ']'.repeat(20_000);

/** Raw request bodies (strings are sent verbatim). */
const RAW_BODIES = [
  ['empty body', ''],
  ['null', 'null'],
  ['array', '[]'],
  ['string', '"str"'],
  ['number', '42'],
  ['truncated JSON', '{"x":'],
  ['5 MB body', `{"csv":"${BIG}"}`],
  ['deeply nested array', DEEP],
  ['__proto__ key', '{"__proto__":{"polluted":true},"status":"active"}'],
  ['constructor key', '{"constructor":{"prototype":{"polluted":true}}}'],
  ['NUL bytes', String.raw`{"firstName":"a\u0000b"}`]
];

/** JSON bodies that exercise every handler's field handling. */
const OBJECT_BODIES = [
  ['empty object', {}],
  ['5000 ids as memberIds', { memberIds: IDS_5000, status: 'active' }],
  ['5000 ids as ids', { ids: IDS_5000 }],
  ['hostile ids', { memberIds: ['abc', 0, -1, 1.5, '99999999999999999999', '%00', '1e3', null, {}, []], ids: ['abc', 0] }],
  ['sparse and nested ids', { memberIds: [1, , [2]], ids: [[1]], status: 'active' }], // eslint-disable-line no-sparse-arrays
  ['numeric status', { memberIds: [1], status: 5, reason: 7 }],
  ['object fields', { firstName: {}, lastName: [], email: 5, status: {}, notes: false, reason: {} }],
  ['null fields', { firstName: null, lastName: null, email: null, status: null, enrollmentTrack: null, csv: null }],
  ['very long strings', { firstName: LONG, lastName: LONG, email: LONG, studentId: LONG, phone: LONG, telegram: LONG, discord: LONG, notes: LONG, enrollmentTrack: LONG, reason: LONG, csv: LONG }],
  ['unicode strings', { firstName: UNICODE, lastName: UNICODE, email: `${UNICODE}@x.fr`, discord: UNICODE, notes: UNICODE, enrollmentTrack: UNICODE, csv: UNICODE }],
  ['unicode in otherwise valid fields', { firstName: UNICODE, lastName: UNICODE, email: 'unicode@test.example', enrollmentTrack: 'Autre', discord: UNICODE, studentId: UNICODE, phone: UNICODE, telegram: UNICODE, notes: UNICODE, reason: UNICODE, status: 'active' }],
  ['unicode in a valid CSV', { csv: `Prénom;Nom;Email;Notes;Telegram\n${UNICODE};x;unicode-csv@test.example;${UNICODE};${UNICODE}` }],
  ['valid-looking application', { firstName: 'A', lastName: 'B', email: 'hostile@test.example', enrollmentTrack: 'Autre', discord: '@a' }],
  ['status values', { status: '__proto__', memberIds: [1] }],
  ['settings keys', { membership_open: {}, current_year: [], enrollment_tracks: 'x', toString: 1, constructor: 1 }],
  ['settings values', { membership_open: 'maybe', current_year: 2024, enrollment_tracks: [null, 1, ['x']] }],
  ['csv header only', { csv: 'Prénom,Nom,Email' }],
  ['csv with hostile cells', { csv: 'Prénom;Nom;Email;Statut;Notes\n"=1+1";\'|x;a@b.fr;__proto__;"unterminated' }],
  ['csv delimiters soup', { csv: ',;\t,;\t\n,;\t\n\n\n"""\n' }],
  ['csv 3000 rows', { csv: 'Prénom,Nom,Email\n' + Array.from({ length: 3000 }, (_, i) => `a,b,c${i}@t.fr`).join('\n') }]
];

const ID_VALUES = [
  'abc', '0', '-1', '1.5', '99999999999999999999', '%00', '1e3', '12abc', 'batch', '__proto__', 'constructor',
  '%E2%82%AC', '%', '..', ' ', 'x'.repeat(5000), '1'.repeat(400)
];

const QUERIES = [
  '', '?status=', '?status=active', '?status=bureau', '?status=nope', '?status=__proto__', `?status=${'x'.repeat(5000)}`,
  '?status=%00', '?status=%0d%0aSet-Cookie:a=b', '?status[]=a', '?status=a&status=b', '?%'
];

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

let requestCounter = 0;
/** A fresh documentation-range IP per request, so no rate limit ever applies. */
function nextIp() {
  requestCounter += 1;
  return `198.51.${(requestCounter >> 8) & 255}.${requestCounter & 255}`;
}

async function send(method, path, { body, token } = {}) {
  const headers = { 'Content-Type': 'application/json', 'CF-Connecting-IP': nextIp() };
  if (token) headers.Authorization = `Bearer ${ADMIN_TOKEN}`;
  const init = { method, headers };
  if (body !== undefined && method !== 'GET') {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  return SELF.fetch(`${BASE}${path}`, init);
}

/** Assert a response is never a 500 and, when it is an error, follows `{ error, code }`. */
async function expectSafe(response, context) {
  const type = response.headers.get('Content-Type') ?? '';
  const text = await response.text();
  expect(response.status, `${context} -> ${response.status} ${text.slice(0, 200)}`).toBeLessThan(500);
  if (response.status >= 400) {
    expect(type, context).toContain('application/json');
    const data = JSON.parse(text);
    expect(typeof data.error, `${context}: error`).toBe('string');
    expect(typeof data.code, `${context}: code`).toBe('string');
    expect(data.error, context).not.toBe('');
  }
}

/** Every request to try for a route: [description, method, path, body]. */
function attacksOn(route, memberId) {
  const paths = route.template.includes(ID_PLACEHOLDER)
    ? [...ID_VALUES, String(memberId)].map((id) => route.template.replace(ID_PLACEHOLDER, id))
    : [route.template, ...(route.method === 'GET' ? QUERIES.map((query) => route.template + query) : [])];

  const bodies = route.method === 'GET' ? [['no body', undefined]] : [...RAW_BODIES, ...OBJECT_BODIES];
  // Hostile ids only with a couple of bodies, hostile bodies only on a plain path.
  const attacks = [];
  for (const path of paths) {
    const pathBodies = path === paths[0] || bodies.length === 1 ? bodies : bodies.slice(0, 3);
    for (const [label, body] of pathBodies) attacks.push([`${route.method} ${path.slice(0, 80)} [${label}]`, route.method, path, body]);
  }
  return attacks;
}

describe('route registry', () => {
  it('discovers the routes of src/routes.js', () => {
    expect(ROUTES.length).toBeGreaterThanOrEqual(13);
    expect(ROUTES.map((route) => route.label)).toEqual(expect.arrayContaining([
      'GET /api/config', 'POST /api/apply', 'PUT /api/admin/members/{id}', 'DELETE /api/admin/members/batch'
    ]));
  });
});

describe.each(ROUTES)('$label never answers 500 on hostile input', (route) => {
  it.each([['without a token', false], ['with a valid admin token', true]])('%s', async (_label, authenticated) => {
    const memberId = await insertMember({ status: 'active' });
    for (const [context, method, path, body] of attacksOn(route, memberId)) {
      const response = await send(method, path, { body, token: authenticated });
      await expectSafe(response, `${authenticated ? 'auth' : 'anon'} ${context}`);
    }
    expect({}.polluted).toBeUndefined();
  }, 120_000);
});

describe('coverage of the attack set', () => {
  it('sends a meaningful number of requests', () => {
    // 13 routes x 2 auth modes x dozens of attacks (about 770 requests): guards against the loops silently shrinking
    expect(requestCounter).toBeGreaterThan(700);
  });
});
