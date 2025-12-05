/**
 * Catch-all API route that delegates to the router
 */

import type { APIRoute } from 'astro';
import { corsHeaders } from '../../lib/router.js';
import { error } from '../../shared/response.js';
import { createRouter } from '../../routes.js';

const router = createRouter();

// Allowed origins for CORS - add development origins as needed
const ALLOWED_ORIGINS = [
  'https://asso.info-evry.fr',
  'http://localhost:4321',
  'http://localhost:3000',
  'http://127.0.0.1:4321',
  'http://127.0.0.1:3000'
];

// Get validated CORS origin from request header
function getCorsOrigin(request: Request): string {
  const origin = request.headers.get('Origin');
  // Only allow whitelisted origins
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    return origin;
  }
  // For same-origin requests (no Origin header), use the request URL origin
  // This is safe because the browser enforces Origin header for cross-origin requests
  if (!origin) {
    return new URL(request.url).origin;
  }
  // Reject unknown origins by returning the first allowed origin
  // This prevents reflecting arbitrary origins
  return ALLOWED_ORIGINS[0];
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
