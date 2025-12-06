/**
 * Public member endpoints
 */

import { json, error } from '../shared/response.js';

/**
 * Get membership settings/config
 * GET /api/config
 */
export async function getConfig(request, env) {
  try {
    // Get settings from database
    const settings = await env.DB.prepare(
      'SELECT key, value FROM settings'
    ).all();

    const config = {};
    for (const row of settings.results || []) {
      try {
        config[row.key] = JSON.parse(row.value);
      } catch {
        config[row.key] = row.value;
      }
    }

    return json({
      config: {
        membershipOpen: config.membership_open !== 'false',
        currentYear: config.current_year || '2024-2025',
        enrollmentTracks: config.enrollment_tracks || [
          'L1 Informatique',
          'L2 Informatique',
          'L3 Informatique',
          'M1 Informatique',
          'M2 Informatique',
          'Autre'
        ]
      }
    });
  } catch (error_) {
    console.error('Config error:', error_);
    return error('Failed to load configuration', 500);
  }
}

/**
 * Get membership stats (public)
 * GET /api/stats
 */
export async function getStats(request, env) {
  try {
    const stats = await env.DB.prepare(`
      SELECT
        COUNT(CASE WHEN status = 'active' THEN 1 END) as active_members,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_applications
      FROM members
    `).first();

    return json({
      stats: {
        activeMembers: stats?.active_members || 0,
        pendingApplications: stats?.pending_applications || 0
      }
    });
  } catch (error_) {
    console.error('Stats error:', error_);
    return error('Failed to load stats', 500);
  }
}
