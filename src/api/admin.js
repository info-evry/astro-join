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
 * Valid member statuses
 */
const VALID_STATUSES = [
  'pending',        // Awaiting approval
  'active',         // Membre actif
  'honor',          // Membre d'honneur
  'secretary',      // Secrétaire (unique)
  'treasurer',      // Trésorier (unique)
  'president',      // Président (unique)
  'honorary_president', // Président d'honneur (unique)
  'vice_president', // Vice-président (unique)
  'rejected',       // Application rejected
  'expired'         // Membership expired
];

/**
 * Bureau positions that can only be held by one person
 * Note: honorary_president is NOT unique - can have multiple
 */
const BUREAU_POSITIONS = ['secretary', 'treasurer', 'president', 'vice_president'];

/**
 * Status display labels
 */
const STATUS_LABELS = {
  pending: 'En attente',
  active: 'Membre actif',
  honor: "Membre d'honneur",
  secretary: 'Secrétaire',
  treasurer: 'Trésorier',
  president: 'Président',
  honorary_president: "Président d'honneur",
  vice_president: 'Vice-président',
  rejected: 'Refusé',
  expired: 'Expiré'
};

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
        COUNT(CASE WHEN status IN ('active', 'honor', 'secretary', 'treasurer', 'president', 'honorary_president', 'vice_president') THEN 1 END) as active,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
        COUNT(CASE WHEN status = 'rejected' THEN 1 END) as rejected,
        COUNT(CASE WHEN status = 'expired' THEN 1 END) as expired
      FROM members
    `).first();

    // Get bureau members
    const bureau = await env.DB.prepare(`
      SELECT id, first_name, last_name, email, status
      FROM members
      WHERE status IN ('secretary', 'treasurer', 'president', 'honorary_president', 'vice_president')
      ORDER BY CASE status
        WHEN 'president' THEN 1
        WHEN 'vice_president' THEN 2
        WHEN 'secretary' THEN 3
        WHEN 'treasurer' THEN 4
        WHEN 'honorary_president' THEN 5
      END
    `).all();

    // Get track distribution
    const tracks = await env.DB.prepare(`
      SELECT enrollment_track, COUNT(*) as count
      FROM members
      WHERE status IN ('active', 'honor', 'secretary', 'treasurer', 'president', 'honorary_president', 'vice_president')
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
      bureau: (bureau.results || []).map(m => ({
        ...m,
        statusLabel: STATUS_LABELS[m.status]
      })),
      trackDistribution: tracks.results || [],
      recentApplications: recent.results || [],
      statusLabels: STATUS_LABELS,
      validStatuses: VALID_STATUSES
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
      // Validate status
      if (!VALID_STATUSES.includes(body.status)) {
        return error(`Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`, 400);
      }

      // Check bureau position uniqueness
      if (BUREAU_POSITIONS.includes(body.status)) {
        const existing = await env.DB.prepare(
          'SELECT id, first_name, last_name FROM members WHERE status = ? AND id != ?'
        ).bind(body.status, memberId).first();

        if (existing) {
          return error(
            `Le rôle ${STATUS_LABELS[body.status]} est déjà attribué à ${existing.first_name} ${existing.last_name}`,
            400
          );
        }
      }

      updates.push('status = ?');
      values.push(body.status);

      // Set approval date and expiry for active-like statuses
      const activeStatuses = ['active', 'honor', ...BUREAU_POSITIONS];
      if (activeStatuses.includes(body.status) && !activeStatuses.includes(current.status)) {
        updates.push('approved_at = CURRENT_TIMESTAMP');
        // Set expiry to end of academic year (August 31)
        const now = new Date();
        const year = now.getMonth() >= 8 ? now.getFullYear() + 1 : now.getFullYear();
        updates.push('expires_at = ?');
        values.push(`${year}-08-31`);
      }
    }
    if (body.enrollmentNumber !== undefined) {
      updates.push('enrollment_number = ?');
      values.push(body.enrollmentNumber?.trim() || null);
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

/**
 * Parse CSV line handling quoted values
 */
function parseCSVLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if ((char === ',' || char === '\t' || char === ';') && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values;
}

/**
 * Map French status labels to internal values
 */
function mapStatusFromLabel(label) {
  if (!label) return 'active';
  const normalized = label.toLowerCase().trim();

  const mappings = {
    'membre actif': 'active',
    'actif': 'active',
    "membre d'honneur": 'honor',
    'honneur': 'honor',
    'secrétaire': 'secretary',
    'secretaire': 'secretary',
    'trésorier': 'treasurer',
    'tresorier': 'treasurer',
    'président': 'president',
    'president': 'president',
    "président d'honneur": 'honorary_president',
    "president d'honneur": 'honorary_president',
    'vice-président': 'vice_president',
    'vice-president': 'vice_president',
    'vice président': 'vice_president',
    'vice president': 'vice_president',
    'en attente': 'pending',
    'pending': 'pending',
    'refusé': 'rejected',
    'refuse': 'rejected',
    'rejected': 'rejected',
    'expiré': 'expired',
    'expire': 'expired',
    'expired': 'expired'
  };

  return mappings[normalized] || 'active';
}

/**
 * Import members from CSV
 * POST /api/admin/import
 * Expected CSV headers: Prénom, Nom, Email, Téléphone, Numéro, Filière d'inscription, Statut
 */
export const importCSV = adminOnly(async (request, env) => {
  try {
    const body = await request.json();
    const { csv: csvData } = body;

    if (!csvData || typeof csvData !== 'string') {
      return error('CSV data is required', 400);
    }

    const lines = csvData.trim().split('\n');
    if (lines.length < 2) {
      return error('CSV must contain at least a header and one data row', 400);
    }

    // Parse headers (handle both French and normalized versions)
    const rawHeaders = parseCSVLine(lines[0]);
    const headerMap = {};

    for (let i = 0; i < rawHeaders.length; i++) {
      const h = rawHeaders[i].toLowerCase().trim();
      if (h === 'prénom' || h === 'prenom' || h === 'firstname') headerMap.firstName = i;
      else if (h === 'nom' || h === 'lastname') headerMap.lastName = i;
      else if (h === 'email' || h === 'mail') headerMap.email = i;
      else if (h === 'téléphone' || h === 'telephone' || h === 'phone' || h === 'tel') headerMap.phone = i;
      else if (h === 'numéro' || h === 'numero' || h === 'number' || h === 'enrollment_number') headerMap.enrollmentNumber = i;
      else if (h === "filière d'inscription" || h === 'filiere' || h === 'track' || h === 'enrollment_track') headerMap.enrollmentTrack = i;
      else if (h === 'statut' || h === 'status') headerMap.status = i;
    }

    // Validate required headers
    if (headerMap.firstName === undefined || headerMap.lastName === undefined || headerMap.email === undefined) {
      return error('CSV must have Prénom, Nom, and Email columns', 400);
    }

    const stats = {
      imported: 0,
      updated: 0,
      skipped: 0,
      errors: []
    };

    // Track bureau positions to prevent duplicates in same import
    const bureauInImport = {};

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const values = parseCSVLine(line);

      const firstName = values[headerMap.firstName]?.trim();
      const lastName = values[headerMap.lastName]?.trim();
      const email = values[headerMap.email]?.toLowerCase().trim();
      const phone = headerMap.phone !== undefined ? values[headerMap.phone]?.trim() : null;
      const enrollmentNumber = headerMap.enrollmentNumber !== undefined ? values[headerMap.enrollmentNumber]?.trim() : null;
      const enrollmentTrack = headerMap.enrollmentTrack !== undefined ? values[headerMap.enrollmentTrack]?.trim() : 'Autre';
      const statusLabel = headerMap.status !== undefined ? values[headerMap.status]?.trim() : null;
      const status = mapStatusFromLabel(statusLabel);

      // Validate required fields
      if (!firstName || !lastName || !email) {
        stats.errors.push(`Row ${i + 1}: Missing required fields`);
        stats.skipped++;
        continue;
      }

      // Validate email format
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        stats.errors.push(`Row ${i + 1}: Invalid email format`);
        stats.skipped++;
        continue;
      }

      // Check bureau position uniqueness
      if (BUREAU_POSITIONS.includes(status)) {
        // Check within this import
        if (bureauInImport[status]) {
          stats.errors.push(`Row ${i + 1}: Role ${STATUS_LABELS[status]} already assigned in this import`);
          stats.skipped++;
          continue;
        }

        // Check in database
        const existing = await env.DB.prepare(
          'SELECT id, first_name, last_name FROM members WHERE status = ? AND email != ?'
        ).bind(status, email).first();

        if (existing) {
          stats.errors.push(`Row ${i + 1}: Role ${STATUS_LABELS[status]} already held by ${existing.first_name} ${existing.last_name}`);
          stats.skipped++;
          continue;
        }

        bureauInImport[status] = email;
      }

      try {
        // Check if member exists
        const existingMember = await env.DB.prepare(
          'SELECT id FROM members WHERE email = ?'
        ).bind(email).first();

        if (existingMember) {
          // Update existing member
          await env.DB.prepare(`
            UPDATE members SET
              first_name = ?,
              last_name = ?,
              phone = COALESCE(?, phone),
              enrollment_number = COALESCE(?, enrollment_number),
              enrollment_track = COALESCE(?, enrollment_track),
              status = ?,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `).bind(
            firstName,
            lastName,
            phone,
            enrollmentNumber,
            enrollmentTrack,
            status,
            existingMember.id
          ).run();

          stats.updated++;
        } else {
          // Insert new member
          const now = new Date();
          const year = now.getMonth() >= 8 ? now.getFullYear() + 1 : now.getFullYear();
          const expiresAt = status !== 'pending' && status !== 'rejected' ? `${year}-08-31` : null;

          await env.DB.prepare(`
            INSERT INTO members (
              first_name, last_name, email, phone, enrollment_number,
              enrollment_track, status, approved_at, expires_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(
            firstName,
            lastName,
            email,
            phone,
            enrollmentNumber,
            enrollmentTrack,
            status,
            status !== 'pending' ? new Date().toISOString() : null,
            expiresAt
          ).run();

          stats.imported++;
        }
      } catch (err) {
        console.error(`Import error row ${i + 1}:`, err);
        stats.errors.push(`Row ${i + 1}: ${err.message}`);
        stats.skipped++;
      }
    }

    return json({
      success: true,
      stats: {
        imported: stats.imported,
        updated: stats.updated,
        skipped: stats.skipped,
        total: stats.imported + stats.updated + stats.skipped
      },
      errors: stats.errors.length > 0 ? stats.errors.slice(0, 10) : undefined
    });
  } catch (err) {
    console.error('Import CSV error:', err);
    return error('Failed to import CSV: ' + err.message, 500);
  }
});
