/**
 * Route registration for membership API
 */

import { Router } from './lib/router.js';
import { apply } from './api/apply.js';
import { getConfig, getStats } from './api/members.js';
import {
  getMembers,
  adminStats,
  updateMember,
  deleteMember,
  batchUpdateMembers,
  exportMembers,
  getSettings,
  updateSettings,
  importCSV
} from './api/admin.js';

export function createRouter() {
  // Pass base path to handle subpath deployments
  const router = new Router('/adhesion');

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

  // Admin API routes - Delete
  router.delete('/api/admin/members/:id', deleteMember);

  return router;
}
