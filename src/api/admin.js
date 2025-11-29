/**
 * Admin API endpoints for membership management
 */

import { json, error, success, csv } from '../shared/response.js';

/**
 * Check admin authorization
 */
function isAuthorized(request, env) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return false;
  const token = authHeader.slice(7);
  return token === env.ADMIN_TOKEN;
}

/**
 * Admin middleware wrapper
 */
function adminOnly(handler) {
  return async (request, env, ctx, params) => {
    if (!isAuthorized(request, env)) {
      return error('Unauthorized', 401);
    }
    return handler(request, env, ctx, params);
  };
}

/**
 * Get all members with stats
 * GET /api/admin/members
 */
export const getMembers = adminOnly(async (request, env) => {
  try {
    const members = await env.DB.prepare(`
      SELECT * FROM members ORDER BY created_at DESC
    `).all();

    const stats = await env.DB.prepare(`
      SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN status = 'active' THEN 1 END) as active,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
        COUNT(CASE WHEN status = 'rejected' THEN 1 END) as rejected,
        COUNT(CASE WHEN status = 'expired' THEN 1 END) as expired
      FROM members
    `).first();

    return json({
      members: members.results || [],
      stats: {
        total: stats?.total || 0,
        active: stats?.active || 0,
        pending: stats?.pending || 0,
        rejected: stats?.rejected || 0,
        expired: stats?.expired || 0
      }
    });
  } catch (err) {
    console.error('Get members error:', err);
    return error('Failed to load members', 500);
  }
});

/**
 * Get admin dashboard stats
 * GET /api/admin/stats
 */
export const adminStats = adminOnly(async (request, env) => {
  try {
    const stats = await env.DB.prepare(`
      SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN status = 'active' THEN 1 END) as active,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
        COUNT(CASE WHEN status = 'rejected' THEN 1 END) as rejected,
        COUNT(CASE WHEN status = 'expired' THEN 1 END) as expired
      FROM members
    `).first();

    // Get track distribution
    const tracks = await env.DB.prepare(`
      SELECT enrollment_track, COUNT(*) as count
      FROM members
      WHERE status = 'active'
      GROUP BY enrollment_track
      ORDER BY count DESC
    `).all();

    // Get recent applications
    const recent = await env.DB.prepare(`
      SELECT * FROM members
      WHERE status = 'pending'
      ORDER BY created_at DESC
      LIMIT 10
    `).all();

    return json({
      stats: {
        total: stats?.total || 0,
        active: stats?.active || 0,
        pending: stats?.pending || 0,
        rejected: stats?.rejected || 0,
        expired: stats?.expired || 0
      },
      trackDistribution: tracks.results || [],
      recentApplications: recent.results || []
    });
  } catch (err) {
    console.error('Admin stats error:', err);
    return error('Failed to load stats', 500);
  }
});

/**
 * Update member status
 * PUT /api/admin/members/:id
 */
export const updateMember = adminOnly(async (request, env, ctx, params) => {
  try {
    const memberId = parseInt(params.id);
    const body = await request.json();

    // Get current member
    const current = await env.DB.prepare(
      'SELECT * FROM members WHERE id = ?'
    ).bind(memberId).first();

    if (!current) {
      return error('Member not found', 404);
    }

    // Build update query
    const updates = [];
    const values = [];

    if (body.firstName !== undefined) {
      updates.push('first_name = ?');
      values.push(body.firstName.trim());
    }
    if (body.lastName !== undefined) {
      updates.push('last_name = ?');
      values.push(body.lastName.trim());
    }
    if (body.email !== undefined) {
      updates.push('email = ?');
      values.push(body.email.toLowerCase().trim());
    }
    if (body.studentId !== undefined) {
      updates.push('student_id = ?');
      values.push(body.studentId?.trim() || null);
    }
    if (body.enrollmentTrack !== undefined) {
      updates.push('enrollment_track = ?');
      values.push(body.enrollmentTrack);
    }
    if (body.phone !== undefined) {
      updates.push('phone = ?');
      values.push(body.phone?.trim() || null);
    }
    if (body.telegram !== undefined) {
      updates.push('telegram = ?');
      values.push(body.telegram?.trim() || null);
    }
    if (body.discord !== undefined) {
      updates.push('discord = ?');
      values.push(body.discord?.trim() || null);
    }
    if (body.status !== undefined) {
      updates.push('status = ?');
      values.push(body.status);

      if (body.status === 'active' && current.status !== 'active') {
        updates.push('approved_at = CURRENT_TIMESTAMP');
        // Set expiry to end of academic year (August 31)
        const now = new Date();
        const year = now.getMonth() >= 8 ? now.getFullYear() + 1 : now.getFullYear();
        updates.push('expires_at = ?');
        values.push(`${year}-08-31`);
      }
    }
    if (body.notes !== undefined) {
      updates.push('notes = ?');
      values.push(body.notes?.trim() || null);
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');

    if (updates.length === 1) {
      return error('No updates provided', 400);
    }

    values.push(memberId);

    await env.DB.prepare(`
      UPDATE members SET ${updates.join(', ')} WHERE id = ?
    `).bind(...values).run();

    // Log status change
    if (body.status !== undefined && body.status !== current.status) {
      await env.DB.prepare(`
        INSERT INTO membership_history (member_id, old_status, new_status, reason)
        VALUES (?, ?, ?, ?)
      `).bind(
        memberId,
        current.status,
        body.status,
        body.reason || 'Status updated by admin'
      ).run();
    }

    return success('Member updated successfully');
  } catch (err) {
    console.error('Update member error:', err);
    return error('Failed to update member', 500);
  }
});

/**
 * Delete member
 * DELETE /api/admin/members/:id
 */
export const deleteMember = adminOnly(async (request, env, ctx, params) => {
  try {
    const memberId = parseInt(params.id);

    const result = await env.DB.prepare(
      'DELETE FROM members WHERE id = ?'
    ).bind(memberId).run();

    if (result.meta.changes === 0) {
      return error('Member not found', 404);
    }

    return success('Member deleted successfully');
  } catch (err) {
    console.error('Delete member error:', err);
    return error('Failed to delete member', 500);
  }
});

/**
 * Batch approve/reject members
 * POST /api/admin/members/batch
 */
export const batchUpdateMembers = adminOnly(async (request, env) => {
  try {
    const body = await request.json();
    const { memberIds, status, reason } = body;

    if (!Array.isArray(memberIds) || memberIds.length === 0) {
      return error('No members specified', 400);
    }
    if (!['active', 'rejected', 'expired'].includes(status)) {
      return error('Invalid status', 400);
    }

    const placeholders = memberIds.map(() => '?').join(',');
    const updates = [`status = '${status}'`, 'updated_at = CURRENT_TIMESTAMP'];

    if (status === 'active') {
      updates.push('approved_at = CURRENT_TIMESTAMP');
      const now = new Date();
      const year = now.getMonth() >= 8 ? now.getFullYear() + 1 : now.getFullYear();
      updates.push(`expires_at = '${year}-08-31'`);
    }

    await env.DB.prepare(`
      UPDATE members SET ${updates.join(', ')} WHERE id IN (${placeholders})
    `).bind(...memberIds).run();

    // Log changes
    for (const id of memberIds) {
      await env.DB.prepare(`
        INSERT INTO membership_history (member_id, new_status, reason)
        VALUES (?, ?, ?)
      `).bind(id, status, reason || 'Batch update by admin').run();
    }

    return success(`${memberIds.length} member(s) updated successfully`);
  } catch (err) {
    console.error('Batch update error:', err);
    return error('Failed to update members', 500);
  }
});

/**
 * Export members to CSV
 * GET /api/admin/export
 */
export const exportMembers = adminOnly(async (request, env) => {
  try {
    const url = new URL(request.url);
    const status = url.searchParams.get('status');

    let query = 'SELECT * FROM members';
    let binding = null;

    if (status) {
      query += ' WHERE status = ?';
      binding = status;
    }

    query += ' ORDER BY last_name, first_name';

    const stmt = binding
      ? env.DB.prepare(query).bind(binding)
      : env.DB.prepare(query);

    const members = await stmt.all();

    // Build CSV
    const headers = [
      'ID', 'Prénom', 'Nom', 'Email', 'Numéro étudiant', 'Cursus',
      'Téléphone', 'Telegram', 'Discord', 'Statut', 'Date adhésion',
      'Date approbation', 'Date expiration'
    ];

    const rows = (members.results || []).map(m => [
      m.id,
      m.first_name,
      m.last_name,
      m.email,
      m.student_id || '',
      m.enrollment_track,
      m.phone || '',
      m.telegram || '',
      m.discord || '',
      m.status,
      m.created_at,
      m.approved_at || '',
      m.expires_at || ''
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));

    const csvContent = [headers.join(','), ...rows].join('\n');
    const filename = status ? `members_${status}.csv` : 'members.csv';

    return csv(csvContent, filename);
  } catch (err) {
    console.error('Export error:', err);
    return error('Failed to export members', 500);
  }
});

/**
 * Get settings
 * GET /api/admin/settings
 */
export const getSettings = adminOnly(async (request, env) => {
  try {
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

    return json({ settings: config });
  } catch (err) {
    console.error('Get settings error:', err);
    return error('Failed to load settings', 500);
  }
});

/**
 * Update settings
 * PUT /api/admin/settings
 */
export const updateSettings = adminOnly(async (request, env) => {
  try {
    const body = await request.json();

    for (const [key, value] of Object.entries(body)) {
      const stringValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
      await env.DB.prepare(`
        INSERT OR REPLACE INTO settings (key, value, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
      `).bind(key, stringValue).run();
    }

    return success('Settings updated successfully');
  } catch (err) {
    console.error('Update settings error:', err);
    return error('Failed to update settings', 500);
  }
});
