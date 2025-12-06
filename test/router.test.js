/**
 * Router Module Tests
 * Tests for the minimal router used in Cloudflare Workers
 */

import { describe, it, expect } from 'vitest';
import { Router, corsHeaders } from '../src/lib/router.js';

describe('Router', () => {
  describe('constructor', () => {
    it('should create router with empty routes', () => {
      const router = new Router();
      expect(router.routes).toHaveLength(0);
    });

    it('should accept base path', () => {
      const router = new Router('/api');
      expect(router.basePath).toBe('/api');
    });

    it('should strip trailing slash from base path', () => {
      const router = new Router('/api/');
      expect(router.basePath).toBe('/api');
    });

    it('should accept custom max body size', () => {
      const router = new Router('', { maxBodySize: 5000 });
      expect(router.maxBodySize).toBe(5000);
    });

    it('should use default max body size', () => {
      const router = new Router();
      expect(router.maxBodySize).toBe(1024 * 1024); // 1MB
    });
  });

  describe('route registration', () => {
    it('should register GET route', () => {
      const router = new Router();
      const handler = () => {};
      router.get('/test', handler);
      expect(router.routes).toHaveLength(1);
      expect(router.routes[0].method).toBe('GET');
    });

    it('should register POST route', () => {
      const router = new Router();
      const handler = () => {};
      router.post('/test', handler);
      expect(router.routes[0].method).toBe('POST');
    });

    it('should register PUT route', () => {
      const router = new Router();
      const handler = () => {};
      router.put('/test', handler);
      expect(router.routes[0].method).toBe('PUT');
    });

    it('should register DELETE route', () => {
      const router = new Router();
      const handler = () => {};
      router.delete('/test', handler);
      expect(router.routes[0].method).toBe('DELETE');
    });

    it('should chain route registrations', () => {
      const router = new Router();
      router.get('/a', () => {}).post('/b', () => {}).put('/c', () => {});
      expect(router.routes).toHaveLength(3);
    });
  });

  describe('route matching', () => {
    it('should match simple path', async () => {
      const router = new Router();
      router.get('/test', () => new Response('ok'));

      const request = new Request('http://localhost/test');
      const response = await router.handle(request, {}, {});

      expect(response.status).toBe(200);
      expect(await response.text()).toBe('ok');
    });

    it('should extract path parameters', async () => {
      const router = new Router();
      router.get('/users/:id', (req, env, ctx, params) => {
        return new Response(JSON.stringify(params));
      });

      const request = new Request('http://localhost/users/123');
      const response = await router.handle(request, {}, {});
      const data = await response.json();

      expect(data.id).toBe('123');
    });

    it('should extract multiple path parameters', async () => {
      const router = new Router();
      router.get('/teams/:teamId/members/:memberId', (req, env, ctx, params) => {
        return new Response(JSON.stringify(params));
      });

      const request = new Request('http://localhost/teams/5/members/10');
      const response = await router.handle(request, {}, {});
      const data = await response.json();

      expect(data.teamId).toBe('5');
      expect(data.memberId).toBe('10');
    });

    it('should return 404 for non-matching path', async () => {
      const router = new Router();
      router.get('/test', () => new Response('ok'));

      const request = new Request('http://localhost/notfound');
      const response = await router.handle(request, {}, {});

      expect(response.status).toBe(404);
    });

    it('should match correct HTTP method', async () => {
      const router = new Router();
      router.get('/test', () => new Response('GET'));
      router.post('/test', () => new Response('POST'));

      const getRequest = new Request('http://localhost/test', { method: 'GET' });
      const getResponse = await router.handle(getRequest, {}, {});
      expect(await getResponse.text()).toBe('GET');

      const postRequest = new Request('http://localhost/test', { method: 'POST' });
      const postResponse = await router.handle(postRequest, {}, {});
      expect(await postResponse.text()).toBe('POST');
    });

    it('should return 404 for wrong HTTP method', async () => {
      const router = new Router();
      router.get('/test', () => new Response('ok'));

      const request = new Request('http://localhost/test', { method: 'POST' });
      const response = await router.handle(request, {}, {});

      expect(response.status).toBe(404);
    });
  });

  describe('base path handling', () => {
    it('should strip base path from request', async () => {
      const router = new Router('/api');
      router.get('/users', () => new Response('users'));

      const request = new Request('http://localhost/api/users');
      const response = await router.handle(request, {}, {});

      expect(response.status).toBe(200);
      expect(await response.text()).toBe('users');
    });

    it('should handle root path after base path', async () => {
      const router = new Router('/api');
      router.get('/', () => new Response('root'));

      const request = new Request('http://localhost/api');
      const response = await router.handle(request, {}, {});

      expect(response.status).toBe(200);
    });
  });

  describe('request body size limit', () => {
    it('should reject POST request exceeding body size limit', async () => {
      const router = new Router('', { maxBodySize: 100 });
      router.post('/upload', () => new Response('ok'));

      const request = new Request('http://localhost/upload', {
        method: 'POST',
        headers: { 'Content-Length': '200' },
        body: 'x'.repeat(200)
      });
      const response = await router.handle(request, {}, {});

      expect(response.status).toBe(413);
    });

    it('should allow POST request within body size limit', async () => {
      const router = new Router('', { maxBodySize: 100 });
      router.post('/upload', () => new Response('ok'));

      const request = new Request('http://localhost/upload', {
        method: 'POST',
        headers: { 'Content-Length': '50' },
        body: 'x'.repeat(50)
      });
      const response = await router.handle(request, {}, {});

      expect(response.status).toBe(200);
    });

    it('should reject PUT request exceeding body size limit', async () => {
      const router = new Router('', { maxBodySize: 100 });
      router.put('/update', () => new Response('ok'));

      const request = new Request('http://localhost/update', {
        method: 'PUT',
        headers: { 'Content-Length': '200' },
        body: 'x'.repeat(200)
      });
      const response = await router.handle(request, {}, {});

      expect(response.status).toBe(413);
    });

    it('should not check body size for GET requests', async () => {
      const router = new Router('', { maxBodySize: 100 });
      router.get('/data', () => new Response('ok'));

      const request = new Request('http://localhost/data', {
        method: 'GET',
        headers: { 'Content-Length': '200' }
      });
      const response = await router.handle(request, {}, {});

      expect(response.status).toBe(200);
    });
  });

  describe('error handling', () => {
    it('should catch handler errors and return 500', async () => {
      const router = new Router();
      router.get('/error', () => {
        throw new Error('Test error');
      });

      const request = new Request('http://localhost/error');
      const response = await router.handle(request, {}, {});

      expect(response.status).toBe(500);
    });
  });
});

describe('corsHeaders', () => {
  it('should return CORS headers with specified origin', () => {
    const headers = corsHeaders('https://example.com');

    expect(headers['Access-Control-Allow-Origin']).toBe('https://example.com');
    expect(headers['Access-Control-Allow-Methods']).toContain('GET');
    expect(headers['Access-Control-Allow-Methods']).toContain('POST');
    expect(headers['Access-Control-Allow-Headers']).toContain('Authorization');
  });

  it('should throw error when origin is not specified', () => {
    expect(() => corsHeaders(null)).toThrow();
    expect(() => corsHeaders()).toThrow();
    expect(() => corsHeaders('')).toThrow();
  });

  it('should include max-age header', () => {
    const headers = corsHeaders('https://example.com');
    expect(headers['Access-Control-Max-Age']).toBe('86400');
  });
});
