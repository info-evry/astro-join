/**
 * Public member endpoints
 */

import { json } from 'astro-core/router';
import { serverError } from 'astro-core/http';
import { loadMembershipConfig } from '../lib/config.js';
import { countMembers } from '../lib/member-stats.js';

/**
 * Get membership settings/config
 * GET /api/config
 */
export async function getConfig(request, env) {
  try {
    return json({ config: await loadMembershipConfig(env.DB) });
  } catch (error_) {
    return serverError('Config error:', error_);
  }
}

/**
 * Get membership stats (public). `activeMembers` counts every active-like
 * status (active, honor and the bureau), like the admin dashboard does.
 * GET /api/stats
 */
export async function getStats(request, env) {
  try {
    const { active, pending } = await countMembers(env.DB);
    return json({ stats: { activeMembers: active, pendingApplications: pending } });
  } catch (error_) {
    return serverError('Stats error:', error_);
  }
}
