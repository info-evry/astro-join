/**
 * Catch-all API route: CORS, router dispatch and safe error answers come from
 * astro-core's createApiRoute.
 */

import { env } from 'cloudflare:workers';
import { createApiRoute } from 'astro-core/api-route';
import { createRouter } from '../../routes.js';

// Allowed origins for CORS, same list as `allowedOriginsFor('join')` in the
// maestro repo's src/sites.ts (a test there compares them). The first entry is
// the fallback for unknown origins.
const ALLOWED_ORIGINS = [
  // Production
  'https://asso.info-evry.fr',
  // Development (Cloudflare Workers)
  'https://ndi-registration-dev.asso-1b5.workers.dev',
  'https://asso-info-evry-dev.asso-1b5.workers.dev',
  'https://join-info-evry-dev.asso-1b5.workers.dev',
  // Local development
  'http://localhost:4321',
  'http://localhost:3000',
  'http://127.0.0.1:4321',
  'http://127.0.0.1:3000'
];

export const { ALL, GET, POST, PUT, DELETE, OPTIONS } = createApiRoute({
  router: createRouter(),
  allowedOrigins: ALLOWED_ORIGINS,
  getEnv: () => env,
  getCtx: (locals: { cfContext?: unknown }) => locals.cfContext
});
