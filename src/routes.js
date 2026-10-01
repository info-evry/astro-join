/**
 * Route registration for membership API
 */

import { Router } from 'astro-core/router';
import { createAdminGuard } from 'astro-core/auth';
import { createRateLimiter, pathPrefix, ADMIN_RATE_LIMIT } from 'astro-core/ratelimit';
import { ADMIN_AUTH_OPTIONS } from './lib/admin-auth.js';
import { apply } from './api/apply.js';
import { getConfig, getStats } from './api/members.js';
import {
  getMembers,
  adminStats,
  updateMember,
  deleteMember,
  batchUpdateMembers,
  deleteMembersBatch,
  getSettings,
  updateSettings
} from './api/admin.js';
import { exportMembers, importCSV } from './api/admin-csv.js';

export function createRouter() {
  // Pass base path to handle subpath deployments
  const router = new Router('/adhesion');

  // Rate limit sensitive endpoints (backed by the RATE_LIMIT KV namespace).
  // It runs before the admin guard so failed token guesses are counted too.
  router.use(createRateLimiter({
    rules: [
      { name: 'apply', methods: ['POST'], match: pathPrefix('/api/apply'), limit: 5, windowSec: 600 },
      ADMIN_RATE_LIMIT
    ]
  }));

  // Defence in depth: nothing under /api/admin is reachable without the admin
  // token even if a handler forgets to wrap itself in adminHandler().
  router.use(createAdminGuard('/api/admin/', ADMIN_AUTH_OPTIONS));

  // Public API routes
  router.get('/api/config', getConfig);
  router.get('/api/stats', getStats);
  router.post('/api/apply', apply);

  // Admin API routes - Read
  router.get('/api/admin/members', getMembers);
  router.get('/api/admin/stats', adminStats);
  router.get('/api/admin/export', exportMembers);
  router.get('/api/admin/settings', getSettings);

  // Admin API routes - Create/Update
  router.put('/api/admin/members/:id', updateMember);
  router.put('/api/admin/settings', updateSettings);
  router.post('/api/admin/members/batch', batchUpdateMembers);
  router.post('/api/admin/import', importCSV);

  // Admin API routes - Delete. The literal "batch" route must come before the
  // ":id" pattern, which would otherwise capture it.
  router.delete('/api/admin/members/batch', deleteMembersBatch);
  router.delete('/api/admin/members/:id', deleteMember);

  return router;
}
