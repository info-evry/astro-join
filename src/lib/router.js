/**
 * Minimal router for Cloudflare Workers
 * No dependencies - uses native Web APIs
 */

// Maximum request body size (1MB default)
const MAX_BODY_SIZE = 1 * 1024 * 1024;

export class Router {
  constructor(basePath = '', options = {}) {
    this.routes = [];
    // Normalize base path (remove trailing slash)
    this.basePath = basePath.replace(/\/$/, '');
    this.maxBodySize = options.maxBodySize || MAX_BODY_SIZE;
  }

  add(method, path, handler) {
    // Convert path pattern to regex
    // Escape backslashes first, then forward slashes, then convert :params
    const pattern = path
      .replace(/\\/g, '\\\\')
      .replace(/\//g, '\\/')
      .replace(/:(\w+)/g, '(?<$1>[^/]+)');
    this.routes.push({
      method: method.toUpperCase(),
      pattern: new RegExp(`^${pattern}$`),
      handler
    });
    return this;
  }

  get(path, handler) { return this.add('GET', path, handler); }
  post(path, handler) { return this.add('POST', path, handler); }
  put(path, handler) { return this.add('PUT', path, handler); }
  delete(path, handler) { return this.add('DELETE', path, handler); }

  async handle(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const method = request.method.toUpperCase();
      let path = url.pathname;

      // Check request body size for POST/PUT requests
      if (method === 'POST' || method === 'PUT') {
        const contentLength = request.headers.get('Content-Length');
        if (contentLength && parseInt(contentLength, 10) > this.maxBodySize) {
          return new Response(
            JSON.stringify({ error: `Request body too large. Maximum size is ${Math.round(this.maxBodySize / 1024)}KB` }),
            { status: 413, headers: { 'Content-Type': 'application/json' } }
          );
        }
      }

      // Strip base path if present
      if (this.basePath && path.startsWith(this.basePath)) {
        path = path.slice(this.basePath.length) || '/';
      }

      for (const route of this.routes) {
        if (route.method !== method && route.method !== 'ALL') continue;
        const match = path.match(route.pattern);
        if (match) {
          const params = match.groups || {};
          return await route.handler(request, env, ctx, params);
        }
      }
      return new Response('Not Found', {status: 404}); // No route matched
    } catch (err) {
      console.error('Router error:', err);
      return new Response(
        'Internal Server Error',
        {
          status: 500,
          statusText: 'Internal Server Error',
          headers: {'Content-Type': 'text/plain'},
        }
      );
    }
  }
}

/**
 * CORS headers for cross-origin requests
 */
/**
 * Returns CORS headers. Always require an explicit origin for security.
 * @param {string} origin - Origin to allow for cross-origin requests (must be specified)
 */
export function corsHeaders(origin) {
  if (!origin) {
    throw new Error("You must explicitly specify the 'origin' for CORS headers; using '*' as a default is insecure.");
  }
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400'
  };
}
