/**
 * Minimal router for Cloudflare Workers
 * No dependencies - uses native Web APIs
 */

export class Router {
  constructor() {
    this.routes = [];
  }

  add(method, path, handler) {
    // Convert path pattern to regex
    const pattern = path
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
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    const path = url.pathname;

    for (const route of this.routes) {
      if (route.method !== method && route.method !== 'ALL') continue;
      const match = path.match(route.pattern);
      if (match) {
        const params = match.groups || {};
        return route.handler(request, env, ctx, params);
      }
    }
    return null; // No route matched
  }
}

/**
 * CORS headers for cross-origin requests
 */
export function corsHeaders(origin = '*') {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400'
  };
}
