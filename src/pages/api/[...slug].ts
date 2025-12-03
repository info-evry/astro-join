/**
 * Catch-all API route that delegates to the router
 */

import type { APIRoute } from 'astro';
import { corsHeaders } from '../../lib/router.js';
import { error } from '../../shared/response.js';
import { createRouter } from '../../routes.js';

const router = createRouter();

// Get CORS origin from request header
function getCorsOrigin(request: Request): string {
  return request.headers.get('Origin') || new URL(request.url).origin;
}

export const ALL: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  const ctx = locals.runtime.ctx;
  const origin = getCorsOrigin(request);

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(origin)
    });
  }

  try {
    const response = await router.handle(request, env, ctx);
    if (response) {
      // Add CORS headers to all API responses
      const headers = new Headers(response.headers);
      Object.entries(corsHeaders(origin)).forEach(([k, v]) => headers.set(k, v));
      return new Response(response.body, {
        status: response.status,
        headers
      });
    }
    return error('Not found', 404);
  } catch (err) {
    console.error('API error:', err);
    return error('Internal server error', 500);
  }
};

// Export individual methods to ensure Astro handles them
export const GET = ALL;
export const POST = ALL;
export const PUT = ALL;
export const DELETE = ALL;
