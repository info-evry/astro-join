/**
 * Routing, authentication and rate limiting across the whole API surface.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { SELF, env } from 'cloudflare:test';
import { createRouter } from '../src/routes.js';
import {
  BASE, ADMIN_TOKEN, adminHeaders, setupSchema, resetMembers,
  insertMember, getMember, adminFetch, applyFetch, validApplication
} from './helpers.js';

beforeAll(setupSchema);
beforeEach(resetMembers);

/** Every admin route, with a concrete path that matches its pattern. */
const ADMIN_ROUTES = [
  ['GET', '/api/admin/members'],
  ['GET', '/api/admin/stats'],
  ['GET', '/api/admin/export'],
  ['GET', '/api/admin/settings'],
  ['PUT', '/api/admin/members/1'],
  ['PUT', '/api/admin/settings'],
  ['POST', '/api/admin/members/batch'],
  ['POST', '/api/admin/import'],
  ['DELETE', '/api/admin/members/1'],
  ['DELETE', '/api/admin/members/batch']
];

describe('unknown paths', () => {
  it.each([
    '/nope',
    '/a/b/c/d/e/f/g/h',
    '/%E0%A4%A',
    '/%2e%2e/%2e%2e/etc/passwd',
    '/adhesion/nope',
    '/robots.txt'
  ])('GET %s is a 404, never a 500', async (path) => {
    const response = await SELF.fetch(`${BASE}${path}`);
    expect(response.status).toBe(404);
    await response.arrayBuffer();
  });

  it.each([
    '/api/nope',
    '/api/admin',
    '/api/admin/',
    '/api/admin/nope',
    '/api//config',
    '/api/config/',
    '/api/members/1',
    '/adhesion/api/nope',
    '/api/%E0%A4%A',
    '/api/admin/members/1/extra'
  ])('GET %s returns a JSON 404', async (path) => {
    const response = await SELF.fetch(`${BASE}${path}`, { headers: adminHeaders });
    expect(response.status).toBe(404);
    expect(response.headers.get('Content-Type')).toContain('application/json');
    expect(await response.json()).toEqual({ error: 'Ressource introuvable', code: 'not_found' });
  });

  it('returns a JSON 404 for a known path with an unregistered method', async () => {
    const response = await SELF.fetch(`${BASE}/api/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Ressource introuvable', code: 'not_found' });
  });

  it('returns a JSON 404 for a known path on a deep unmatched method (PUT /api/stats)', async () => {
    const response = await SELF.fetch(`${BASE}/api/stats`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    expect(response.status).toBe(404);
  });

  it('still serves the admin page', async () => {
    const response = await SELF.fetch(`${BASE}/manage`);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/html');
    await response.arrayBuffer();
  });
});

describe('cross-origin protections', () => {
  it('rejects a cross-site form-typed POST before it reaches the router', async () => {
    const response = await SELF.fetch(`${BASE}/api/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(validApplication())
    });
    expect(response.status).toBe(403);
  });

  it('answers CORS preflight with 204 and the allowed origin', async () => {
    const response = await SELF.fetch(`${BASE}/api/apply`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:4321' }
    });
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:4321');
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain('Authorization');
  });

  it('never reflects an unknown origin', async () => {
    const response = await SELF.fetch(`${BASE}/api/config`, {
      headers: { Origin: 'https://evil.example' }
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://asso.info-evry.fr');
    await response.arrayBuffer();
  });

  it('adds CORS headers to error responses too', async () => {
    const response = await SELF.fetch(`${BASE}/api/admin/members`, {
      headers: { Origin: 'http://localhost:3000' }
    });
    expect(response.status).toBe(401);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:3000');
    await response.arrayBuffer();
  });
});

describe('admin route registry', () => {
  const registered = createRouter().routes
    .filter((route) => route.pattern.source.includes(String.raw`api\/admin`));

  it('the table lists every admin route registered in src/routes.js', () => {
    const uncovered = registered.filter((route) =>
      !ADMIN_ROUTES.some(([method, path]) => route.method === method && route.pattern.test(path))
    );
    expect(uncovered.map((route) => `${route.method} ${route.pattern.source}`)).toEqual([]);
  });

  it('the table has no entry that matches no registered admin route', () => {
    const stale = ADMIN_ROUTES.filter(([method, path]) =>
      !registered.some((route) => route.method === method && route.pattern.test(path))
    );
    expect(stale).toEqual([]);
  });

  it('registers exactly the expected number of admin routes', () => {
    expect(registered).toHaveLength(ADMIN_ROUTES.length);
  });
});

describe('admin authentication on every admin route', () => {
  const BAD_AUTH_HEADERS = {
    'no header': undefined,
    'wrong token': 'Bearer wrong-token',
    'same-length wrong token': `Bearer ${'x'.repeat(ADMIN_TOKEN.length)}`,
    'token prefix': `Bearer ${ADMIN_TOKEN.slice(0, -1)}`,
    'token with extra suffix': `Bearer ${ADMIN_TOKEN}-extra`,
    'empty bearer': 'Bearer ',
    'bare bearer word': 'Bearer',
    'lowercase scheme': `bearer ${ADMIN_TOKEN}`,
    'bare token without scheme': ADMIN_TOKEN,
    'basic scheme': 'Basic dXNlcjp0ZXN0LWFkbWluLXRva2Vu'
  };

  describe.each(ADMIN_ROUTES)('%s %s', (method, path) => {
    it.each(Object.entries(BAD_AUTH_HEADERS))('returns 401 with %s', async (_label, header) => {
      const headers = { 'Content-Type': 'application/json' };
      if (header !== undefined) headers.Authorization = header;
      const init = { method, headers };
      if (method === 'POST' || method === 'PUT') init.body = '{}';

      const response = await SELF.fetch(`${BASE}${path}`, init);

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: 'Non autorisé', code: 'unauthorized' });
    });
  });

  it('does not parse the body or touch the database before authenticating', async () => {
    const id = await insertMember({ status: 'pending' });

    const del = await SELF.fetch(`${BASE}/api/admin/members/${id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' }
    });
    const put = await SELF.fetch(`${BASE}/api/admin/members/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json'
    });
    const batch = await SELF.fetch(`${BASE}/api/admin/members/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberIds: [id], status: 'active' })
    });

    expect([del.status, put.status, batch.status]).toEqual([401, 401, 401]);
    expect((await getMember(id)).status).toBe('pending');
  });

  it('accepts the valid token on a read route', async () => {
    const response = await adminFetch('/api/admin/stats');
    expect(response.status).toBe(200);
    await response.arrayBuffer();
  });
});

describe('rate limiting', () => {
  const ADMIN_LIMIT = 60;

  // Windows are fixed (60 s admin, 600 s apply, aligned to the epoch). Freeze the
  // clock mid-window so a burst can never straddle a boundary and flake.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2031-03-10T10:05:30Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('allows 60 admin requests per minute and answers the 61st with 429', async () => {
    const ip = '198.51.100.7';
    for (let i = 0; i < ADMIN_LIMIT; i++) {
      const response = await adminFetch('/api/admin/settings', { headers: { 'CF-Connecting-IP': ip } });
      expect(response.status).toBe(200);
      await response.arrayBuffer();
    }

    const blocked = await adminFetch('/api/admin/settings', { headers: { 'CF-Connecting-IP': ip } });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('X-RateLimit-Limit')).toBe('60');
    expect(blocked.headers.get('X-RateLimit-Remaining')).toBe('0');
    expect(blocked.headers.get('Retry-After')).toBe('30');
    expect((await blocked.json()).error).toBeDefined();
  });

  it('starts a fresh admin budget in the next window', async () => {
    const ip = '198.51.100.20';
    for (let i = 0; i < ADMIN_LIMIT; i++) {
      const response = await adminFetch('/api/admin/settings', { headers: { 'CF-Connecting-IP': ip } });
      await response.arrayBuffer();
    }
    expect((await adminFetch('/api/admin/settings', { headers: { 'CF-Connecting-IP': ip } })).status).toBe(429);

    vi.setSystemTime(new Date('2031-03-10T10:06:01Z'));
    const next = await adminFetch('/api/admin/settings', { headers: { 'CF-Connecting-IP': ip } });
    expect(next.status).toBe(200);
    await next.arrayBuffer();
  });

  it('counts unauthenticated admin requests, so token guessing is throttled', async () => {
    const ip = '198.51.100.8';
    for (let i = 0; i < ADMIN_LIMIT; i++) {
      const response = await SELF.fetch(`${BASE}/api/admin/members`, {
        headers: { Authorization: `Bearer guess-${i}`, 'CF-Connecting-IP': ip }
      });
      expect(response.status).toBe(401);
      await response.arrayBuffer();
    }

    const blocked = await SELF.fetch(`${BASE}/api/admin/members`, {
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}`, 'CF-Connecting-IP': ip }
    });
    expect(blocked.status).toBe(429);
  });

  it('shares one admin budget across routes and methods', async () => {
    const ip = '198.51.100.9';
    for (let i = 0; i < ADMIN_LIMIT; i++) {
      const response = await adminFetch(i % 2 === 0 ? '/api/admin/stats' : '/api/admin/members/999999', {
        method: i % 2 === 0 ? 'GET' : 'DELETE',
        headers: { 'CF-Connecting-IP': ip }
      });
      await response.arrayBuffer();
    }
    const blocked = await adminFetch('/api/admin/export', { headers: { 'CF-Connecting-IP': ip } });
    expect(blocked.status).toBe(429);
  });

  it('tracks admin budgets per client IP', async () => {
    for (let i = 0; i < ADMIN_LIMIT; i++) {
      const response = await adminFetch('/api/admin/settings', { headers: { 'CF-Connecting-IP': '198.51.100.10' } });
      await response.arrayBuffer();
    }
    const other = await adminFetch('/api/admin/settings', { headers: { 'CF-Connecting-IP': '198.51.100.11' } });
    expect(other.status).toBe(200);
    await other.arrayBuffer();
  });

  it('does not rate limit public GET endpoints', async () => {
    for (let i = 0; i < ADMIN_LIMIT + 5; i++) {
      const response = await SELF.fetch(`${BASE}/api/stats`, { headers: { 'CF-Connecting-IP': '198.51.100.12' } });
      expect(response.status).toBe(200);
      await response.arrayBuffer();
    }
  });

  it('allows 5 applications per IP and answers the 6th with 429', async () => {
    const ip = '198.51.100.13';
    for (let i = 0; i < 5; i++) {
      const response = await applyFetch(validApplication(), { ip });
      expect(response.status).toBe(200);
      await response.arrayBuffer();
    }
    const blocked = await applyFetch(validApplication(), { ip });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('X-RateLimit-Limit')).toBe('5');
    expect(blocked.headers.get('Retry-After')).toBe('270');
  });

  it('counts rejected applications against the apply budget', async () => {
    const ip = '198.51.100.14';
    for (let i = 0; i < 5; i++) {
      const response = await applyFetch({ firstName: '' }, { ip });
      expect(response.status).toBe(400);
      await response.arrayBuffer();
    }
    const blocked = await applyFetch(validApplication(), { ip });
    expect(blocked.status).toBe(429);
  });

  it('keeps apply and admin budgets independent', async () => {
    const ip = '198.51.100.15';
    for (let i = 0; i < 5; i++) {
      const response = await applyFetch(validApplication(), { ip });
      await response.arrayBuffer();
    }
    const admin = await adminFetch('/api/admin/settings', { headers: { 'CF-Connecting-IP': ip } });
    expect(admin.status).toBe(200);
    await admin.arrayBuffer();
  });

  it('applies the apply budget to POST only', async () => {
    const ip = '198.51.100.16';
    for (let i = 0; i < 8; i++) {
      const response = await SELF.fetch(`${BASE}/api/apply`, { headers: { 'CF-Connecting-IP': ip } });
      expect(response.status).toBe(404);
      await response.arrayBuffer();
    }
    const response = await applyFetch(validApplication(), { ip });
    expect(response.status).toBe(200);
  });
});

describe('admin guard (defence in depth)', () => {
  it.each(['/api/admin', '/api/admin/', '/api/admin/nope', '/api/admin/members/1/extra'])(
    'answers 401, not 404, for GET %s without a token',
    async (path) => {
      const response = await SELF.fetch(`${BASE}${path}`);
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: 'Non autorisé', code: 'unauthorized' });
    }
  );

  it('guards on a path-segment boundary: /api/administrator is just an unknown path', async () => {
    const response = await SELF.fetch(`${BASE}/api/administrator`);
    expect(response.status).toBe(404);
    await response.arrayBuffer();
  });

  it('works without a CONFIG KV namespace: the ADMIN_TOKEN secret alone authenticates', async () => {
    const response = await adminFetch('/api/admin/settings');
    expect(response.status).toBe(200);
    await response.arrayBuffer();
  });

  it('never lets a stray CONFIG KV binding override the ADMIN_TOKEN secret', async () => {
    const fakeEnv = { DB: env.DB, ADMIN_TOKEN: 'secret-token', CONFIG: { get: async () => 'kv-token' } };
    const call = (token) => createRouter().handle(
      new Request(`${BASE}/api/admin/settings`, { headers: { Authorization: `Bearer ${token}` } }),
      fakeEnv,
      {}
    );

    expect((await call('secret-token')).status).toBe(200);
    expect((await call('kv-token')).status).toBe(401);
  });
});

describe('apply rate limit matches on path segments', () => {
  const post = (path, ip) => SELF.fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
    body: '{}'
  });

  it('limits /api/apply and anything below it', async () => {
    const ip = '198.51.100.30';
    for (let i = 0; i < 5; i++) expect((await post('/api/apply/extra', ip)).status).toBe(404);
    expect((await post('/api/apply', ip)).status).toBe(429);
  });

  it('does not limit /api/applyX, which only shares the prefix', async () => {
    const ip = '198.51.100.31';
    for (let i = 0; i < 7; i++) expect((await post('/api/applyX', ip)).status).toBe(404);
  });
});

describe('CORS allow-list', () => {
  // Same list as allowedOriginsFor('join') in the maestro repo's src/sites.ts.
  const ALLOWED = [
    'https://asso.info-evry.fr',
    'https://ndi-registration-dev.asso-1b5.workers.dev',
    'https://asso-info-evry-dev.asso-1b5.workers.dev',
    'https://join-info-evry-dev.asso-1b5.workers.dev',
    'http://localhost:4321',
    'http://localhost:3000',
    'http://127.0.0.1:4321',
    'http://127.0.0.1:3000'
  ];

  it.each(ALLOWED)('answers a preflight from %s with that origin', async (origin) => {
    const response = await SELF.fetch(`${BASE}/api/apply`, { method: 'OPTIONS', headers: { Origin: origin } });
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin);
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('DELETE');
  });

  it('does not allow the ndi subdomain (it is only in the ndi list)', async () => {
    const response = await SELF.fetch(`${BASE}/api/config`, { headers: { Origin: 'https://ndi.asso.info-evry.fr' } });
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://asso.info-evry.fr');
    await response.arrayBuffer();
  });

  it('marks responses as varying on Origin', async () => {
    const response = await SELF.fetch(`${BASE}/api/config`);
    expect(response.headers.get('Vary')).toContain('Origin');
    await response.arrayBuffer();
  });
});
