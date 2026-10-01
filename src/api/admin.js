/**
 * Admin API endpoints for membership management
 */

import { json, error, success, csv } from 'astro-core/router';
import { isValidEmail } from 'astro-core/validation';
import { readJsonObject, isUniqueConstraintError } from '../lib/request.js';

/**
 * Constant-time string comparison to prevent timing attacks
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }

  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);

  // If lengths differ, compare a against itself to maintain constant time
  if (aBytes.length !== bBytes.length) {
    let _unused = 0;
    for (const aByte of aBytes) {
      _unused |= aByte ^ aByte;
    }
    return false;
  }

  // XOR all bytes and accumulate differences
  let result = 0;
  for (const [i, aByte] of aBytes.entries()) {
    result |= aByte ^ bBytes[i];
  }

  return result === 0;
}

/**
 * Check admin authorization using constant-time comparison
 */
function isAuthorized(request, env) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return false;
  const token = authHeader.slice(7);
  if (!token || !env.ADMIN_TOKEN) return false;
  return timingSafeEqual(token, env.ADMIN_TOKEN);
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
 * Parse a :id route parameter. Only plain positive integers are accepted, so
 * "12abc" or "3.5" can never address member 12 or 3 by accident.
 * @param {string} raw
 * @returns {number | null}
 */
function parseMemberId(raw) {
  if (!/^\d{1,15}$/.test(raw)) return null;
  const id = Number(raw);
  return id > 0 ? id : null;
}

const MEMBER_NOT_FOUND = 'Member not found';
const INVALID_BODY = 'Invalid request body: a JSON object is required';

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
  } catch (error_) {
    console.error('Get members error:', error_);
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
  } catch (error_) {
    console.error('Admin stats error:', error_);
    return error('Failed to load stats', 500);
  }
});

/**
 * Text columns editable through PUT /api/admin/members/:id.
 * Required ones can never be null; identity ones can never be blank.
 */
const TEXT_FIELDS = [
  'firstName', 'lastName', 'email', 'studentId', 'enrollmentTrack',
  'phone', 'telegram', 'discord', 'enrollmentNumber', 'notes'
];
const NON_NULL_FIELDS = new Set(['firstName', 'lastName', 'email', 'enrollmentTrack']);
const NON_BLANK_FIELDS = new Set(['firstName', 'lastName', 'email']);

/**
 * Validate the types of the editable text fields so malformed input is
 * answered with a 400 instead of crashing inside the field transforms.
 * @returns {string | null} an error message, or null if the body is valid
 */
function validateFieldTypes(body) {
  for (const key of TEXT_FIELDS) {
    const value = body[key];
    if (value === undefined) continue;
    if (value === null) {
      if (NON_NULL_FIELDS.has(key)) return `${key} cannot be null`;
      continue;
    }
    if (typeof value !== 'string') return `${key} must be a string`;
    if (NON_BLANK_FIELDS.has(key) && !value.trim()) return `${key} cannot be empty`;
  }
  if (body.email !== undefined && !isValidEmail(body.email)) {
    return 'Invalid email format';
  }
  return null;
}

/**
 * Build field updates from request body
 */
function buildFieldUpdates(body, updates, values) {
  const fieldMappings = [
    ['firstName', 'first_name', v => v.trim()],
    ['lastName', 'last_name', v => v.trim()],
    ['email', 'email', v => v.toLowerCase().trim()],
    ['studentId', 'student_id', v => v?.trim() || null],
    ['enrollmentTrack', 'enrollment_track', v => v],
    ['phone', 'phone', v => v?.trim() || null],
    ['telegram', 'telegram', v => v?.trim() || null],
    ['discord', 'discord', v => v?.trim() || null],
    ['enrollmentNumber', 'enrollment_number', v => v?.trim() || null],
    ['notes', 'notes', v => v?.trim() || null]
  ];

  for (const [bodyKey, dbColumn, transform] of fieldMappings) {
    if (body[bodyKey] !== undefined) {
      updates.push(`${dbColumn} = ?`);
      values.push(transform(body[bodyKey]));
    }
  }
}

/**
 * Handle bureau position status update with atomic check
 */
async function handleBureauStatusUpdate(database, memberId, newStatus, currentStatus, reason) {
  const atomicResult = await database.prepare(`
    UPDATE members
    SET status = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
      AND NOT EXISTS (
        SELECT 1 FROM members WHERE status = ? AND id != ?
      )
  `).bind(newStatus, memberId, newStatus, memberId).run();

  if (atomicResult.meta.changes === 0) {
    const existing = await database.prepare(
      'SELECT id, first_name, last_name FROM members WHERE status = ? AND id != ?'
    ).bind(newStatus, memberId).first();

    if (existing) {
      return { error: `Le rôle ${STATUS_LABELS[newStatus]} est déjà attribué à ${existing.first_name} ${existing.last_name}` };
    }
    return { error: MEMBER_NOT_FOUND, status: 404 };
  }

  // Log status change
  await database.prepare(`
    INSERT INTO membership_history (member_id, old_status, new_status, reason)
    VALUES (?, ?, ?, ?)
  `).bind(memberId, currentStatus, newStatus, reason || 'Status updated by admin').run();

  return { success: true };
}

/**
 * Set approval date and expiry for active-like statuses
 */
async function setApprovalDates(database, memberId, newStatus, currentStatus, updates, values) {
  const activeStatuses = new Set(['active', 'honor', ...BUREAU_POSITIONS]);
  if (activeStatuses.has(newStatus) && !activeStatuses.has(currentStatus)) {
    const now = new Date();
    const year = now.getMonth() >= 8 ? now.getFullYear() + 1 : now.getFullYear();

    updates.push('approved_at = CURRENT_TIMESTAMP');
    updates.push('expires_at = ?');
    values.push(`${year}-08-31`);
  }
}

/**
 * Handle status change in member update
 * Returns { done: true } if update was completed, or { error, status } if failed, or {} to continue
 */
async function handleStatusChange(database, memberId, body, current, updates, values) {
  if (body.status === undefined) return {};

  if (!VALID_STATUSES.includes(body.status)) {
    return { error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`, status: 400 };
  }

  if (BUREAU_POSITIONS.includes(body.status)) {
    const result = await handleBureauStatusUpdate(database, memberId, body.status, current.status, body.reason);
    if (result.error) return result;

    // The status itself is already written (atomically). Dates and any other
    // field edits go through the regular update, so promoting a pending
    // member while editing their details still sets approval/expiry.
    await setApprovalDates(database, memberId, body.status, current.status, updates, values);
    if (updates.length === 0) return { done: true };
  } else {
    updates.push('status = ?');
    values.push(body.status);
    await setApprovalDates(database, memberId, body.status, current.status, updates, values);
  }

  return {};
}

/**
 * Log member status change to history
 */
async function logStatusChange(database, memberId, body, current) {
  if (body.status !== undefined && body.status !== current.status && !BUREAU_POSITIONS.includes(body.status)) {
    await database.prepare(`
      INSERT INTO membership_history (member_id, old_status, new_status, reason)
      VALUES (?, ?, ?, ?)
    `).bind(memberId, current.status, body.status, body.reason || 'Status updated by admin').run();
  }
}

/**
 * Update member status
 * PUT /api/admin/members/:id
 */
export const updateMember = adminOnly(async (request, env, ctx, params) => {
  try {
    const memberId = parseMemberId(params.id);
    if (memberId === null) {
      return error(MEMBER_NOT_FOUND, 404);
    }
    const body = await readJsonObject(request);
    if (!body) {
      return error(INVALID_BODY, 400);
    }
    const typeError = validateFieldTypes(body);
    if (typeError) {
      return error(typeError, 400);
    }

    const current = await env.DB.prepare('SELECT * FROM members WHERE id = ?').bind(memberId).first();
    if (!current) {
      return error(MEMBER_NOT_FOUND, 404);
    }

    const updates = [];
    const values = [];

    buildFieldUpdates(body, updates, values);

    const statusResult = await handleStatusChange(env.DB, memberId, body, current, updates, values);
    if (statusResult.error) return error(statusResult.error, statusResult.status || 400);
    if (statusResult.done) return success('Member updated successfully');

    updates.push('updated_at = CURRENT_TIMESTAMP');

    if (updates.length === 1) {
      return error('No updates provided', 400);
    }

    values.push(memberId);
    await env.DB.prepare(`UPDATE members SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();

    await logStatusChange(env.DB, memberId, body, current);

    return success('Member updated successfully');
  } catch (error_) {
    if (isUniqueConstraintError(error_)) {
      return error('Email already used by another member', 409);
    }
    console.error('Update member error:', error_);
    return error('Failed to update member', 500);
  }
});

/**
 * Delete member
 * DELETE /api/admin/members/:id
 */
export const deleteMember = adminOnly(async (request, env, ctx, params) => {
  try {
    const memberId = parseMemberId(params.id);
    if (memberId === null) {
      return error(MEMBER_NOT_FOUND, 404);
    }

    const result = await env.DB.prepare(
      'DELETE FROM members WHERE id = ?'
    ).bind(memberId).run();

    if (result.meta.changes === 0) {
      return error(MEMBER_NOT_FOUND, 404);
    }

    return success('Member deleted successfully');
  } catch (error_) {
    console.error('Delete member error:', error_);
    return error('Failed to delete member', 500);
  }
});

/** Upper bound on ids accepted by one batch request. */
const BATCH_MAX_IDS = 1000;
/** D1 allows at most 100 bound parameters per query, so work in small chunks. */
const BATCH_CHUNK_SIZE = 50;
const BATCH_STATUSES = new Set(['active', 'rejected', 'expired']);

/**
 * Validate a batch request body.
 * @returns {string | null} an error message, or null if valid
 */
function validateBatchBody({ memberIds, status, reason }) {
  if (!Array.isArray(memberIds) || memberIds.length === 0) return 'No members specified';
  if (memberIds.length > BATCH_MAX_IDS) return `Too many members (maximum ${BATCH_MAX_IDS})`;
  if (!memberIds.every((id) => Number.isSafeInteger(id) && id > 0)) return 'memberIds must be positive integers';
  if (!BATCH_STATUSES.has(status)) return 'Invalid status';
  if (reason !== undefined && reason !== null && typeof reason !== 'string') return 'reason must be a string';
  return null;
}

/**
 * Apply a batch status change to one chunk of ids, skipping ids that do not
 * exist, and log each change in the membership history.
 * @returns {Promise<number>} number of members updated
 */
async function updateBatchChunk(database, ids, status, reason) {
  const placeholders = ids.map(() => '?').join(',');
  const { results } = await database.prepare(
    `SELECT id FROM members WHERE id IN (${placeholders})`
  ).bind(...ids).all();
  const existingIds = results.map((row) => row.id);
  if (existingIds.length === 0) return 0;

  const updates = ['status = ?', 'updated_at = CURRENT_TIMESTAMP'];
  const values = [status];
  if (status === 'active') {
    const now = new Date();
    const year = now.getMonth() >= 8 ? now.getFullYear() + 1 : now.getFullYear();
    updates.push('approved_at = CURRENT_TIMESTAMP', 'expires_at = ?');
    values.push(`${year}-08-31`);
  }

  await database.prepare(
    `UPDATE members SET ${updates.join(', ')} WHERE id IN (${existingIds.map(() => '?').join(',')})`
  ).bind(...values, ...existingIds).run();

  await database.batch(existingIds.map((id) => database.prepare(`
    INSERT INTO membership_history (member_id, new_status, reason)
    VALUES (?, ?, ?)
  `).bind(id, status, reason || 'Batch update by admin')));

  return existingIds.length;
}

/**
 * Batch approve/reject members
 * POST /api/admin/members/batch
 */
export const batchUpdateMembers = adminOnly(async (request, env) => {
  try {
    const body = await readJsonObject(request);
    if (!body) {
      return error(INVALID_BODY, 400);
    }
    const validationError = validateBatchBody(body);
    if (validationError) {
      return error(validationError, 400);
    }

    const { memberIds, status, reason } = body;
    const ids = [...new Set(memberIds)];
    let updated = 0;
    for (let i = 0; i < ids.length; i += BATCH_CHUNK_SIZE) {
      updated += await updateBatchChunk(env.DB, ids.slice(i, i + BATCH_CHUNK_SIZE), status, reason);
    }

    if (updated === 0) {
      return error('No matching members found', 404);
    }
    return success(`${updated} member(s) updated successfully`);
  } catch (error_) {
    console.error('Batch update error:', error_);
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
    ].map(v => {
      let str = String(v).replaceAll('"', '""');
      // Escape formula injection characters to prevent CSV injection attacks
      // Include pipe (|) for DDE attacks and semicolon (;) for localized formulas
      if (/^[=+\-@\t\r|;]/.test(str)) {
        str = "'" + str;
      }
      return `"${str}"`;
    }).join(','));

    const csvContent = [headers.join(','), ...rows].join('\n');
    // The status comes from the query string: keep it safe for a header value
    const filename = status ? `members_${status.replaceAll(/\W/g, '_')}.csv` : 'members.csv';

    return csv(csvContent, filename);
  } catch (error_) {
    console.error('Export error:', error_);
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
  } catch (error_) {
    console.error('Get settings error:', error_);
    return error('Failed to load settings', 500);
  }
});

/**
 * Allowlist of settings keys the admin API accepts, each with a validator
 * that returns true if the incoming value is acceptable for that key.
 */
const VALID_KEYS = {
  // Boolean-ish: real boolean, or the strings 'true'/'false'
  membership_open: (value) =>
    typeof value === 'boolean' || value === 'true' || value === 'false',
  // Academic year range, e.g. "2024-2025" (second year = first + 1)
  current_year: (value) => {
    if (typeof value !== 'string') return false;
    const match = /^(\d{4})-(\d{4})$/.exec(value);
    if (!match) return false;
    return Number(match[2]) === Number(match[1]) + 1;
  },
  // Array of up to 20 non-empty strings, each up to 60 characters
  enrollment_tracks: (value) =>
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 20 &&
    value.every((track) => typeof track === 'string' && track.trim().length > 0 && track.length <= 60)
};

/**
 * Update settings
 * PUT /api/admin/settings
 */
export const updateSettings = adminOnly(async (request, env) => {
  try {
    const body = await readJsonObject(request);
    if (!body) {
      return error(INVALID_BODY, 400);
    }
    const keys = Object.keys(body);

    const unknownKeys = keys.filter((key) => !Object.hasOwn(VALID_KEYS, key));
    if (unknownKeys.length > 0) {
      return error(`Unknown setting key(s): ${unknownKeys.join(', ')}`, 400);
    }

    const invalidKeys = keys.filter((key) => !VALID_KEYS[key](body[key]));
    if (invalidKeys.length > 0) {
      return error(`Invalid value for setting key(s): ${invalidKeys.join(', ')}`, 400);
    }

    for (const [key, value] of Object.entries(body)) {
      const stringValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
      await env.DB.prepare(`
        INSERT OR REPLACE INTO settings (key, value, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
      `).bind(key, stringValue).run();
    }

    return success('Settings updated successfully');
  } catch (error_) {
    console.error('Update settings error:', error_);
    return error('Failed to update settings', 500);
  }
});

/** Cell separators accepted outside quotes (comma, tab and semicolon exports). */
const CSV_DELIMITERS = new Set([',', '\t', ';']);

/**
 * Read a quoted cell body starting just after its opening quote.
 * A doubled quote ("") is a literal quote; a lone quote ends the cell.
 * @returns {{ value: string, next: number }} cell text and index after the closing quote
 */
function readQuotedCell(text, start) {
  let value = '';
  let index = start;
  while (index < text.length) {
    if (text[index] !== '"') {
      value += text[index++];
    } else if (text[index + 1] === '"') {
      value += '"';
      index += 2;
    } else {
      return { value, next: index + 1 };
    }
  }
  return { value, next: index };
}

/**
 * Parse CSV text into rows of trimmed cells.
 * Handles quoted cells (embedded delimiters, newlines and doubled quotes),
 * LF/CRLF/CR line endings and a leading BOM. Blank rows are dropped. A quote
 * only opens a quoted cell at the start of a cell, so a stray quote inside
 * unquoted text is kept literally instead of swallowing the following rows.
 * @param {string} text
 * @returns {string[][]}
 */
function parseCSV(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let index = text.startsWith('\uFEFF') ? 1 : 0;

  const endCell = () => {
    row.push(cell.trim());
    cell = '';
  };
  const endRow = () => {
    endCell();
    if (row.some(Boolean)) rows.push(row);
    row = [];
  };

  while (index < text.length) {
    const char = text[index];
    if (char === '"' && cell.trim() === '') {
      const quoted = readQuotedCell(text, index + 1);
      cell = quoted.value;
      index = quoted.next;
    } else if (CSV_DELIMITERS.has(char)) {
      endCell();
      index++;
    } else if (char === '\n' || char === '\r') {
      index += char === '\r' && text[index + 1] === '\n' ? 2 : 1;
      endRow();
    } else {
      cell += char;
      index++;
    }
  }
  endRow();
  return rows;
}

/**
 * Map French status labels to internal values
 */
function mapStatusFromLabel(label) {
  if (!label) return 'active';
  const normalized = label.toLowerCase().trim();

  // Internal values, as written by the CSV export (e.g. "treasurer")
  if (VALID_STATUSES.includes(normalized)) return normalized;

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

// Header mappings for CSV import
const HEADER_MAPPINGS = {
  firstName: ['prénom', 'prenom', 'firstname'],
  lastName: ['nom', 'lastname'],
  email: ['email', 'mail'],
  phone: ['téléphone', 'telephone', 'phone', 'tel'],
  studentId: ['numéro étudiant', 'numero etudiant', 'n° étudiant', 'student_id', 'numéro', 'numero'],
  enrollmentNumber: ['enrollment_number'],
  enrollmentTrack: ["filière d'inscription", 'filiere', 'track', 'enrollment_track', 'cursus'],
  status: ['statut', 'status']
};

/**
 * Parse CSV headers to field mappings
 */
function parseCSVHeaders(rawHeaders) {
  const headerMap = {};
  for (const [i, rawHeader] of rawHeaders.entries()) {
    const h = rawHeader.toLowerCase().trim();
    for (const [field, aliases] of Object.entries(HEADER_MAPPINGS)) {
      if (aliases.includes(h)) {
        headerMap[field] = i;
        break;
      }
    }
  }
  return headerMap;
}

/**
 * Extract member data from a parsed CSV row. Blank or absent optional cells
 * become null so they never overwrite stored values; insert-time defaults are
 * applied in importOrUpdateMember.
 */
function extractMemberFromRow(values, headerMap) {
  const cell = (field) => {
    const index = headerMap[field];
    return index === undefined ? null : values[index]?.trim() || null;
  };
  const statusLabel = cell('status');

  return {
    firstName: cell('firstName'),
    lastName: cell('lastName'),
    email: cell('email')?.toLowerCase() ?? null,
    phone: cell('phone'),
    studentId: cell('studentId'),
    enrollmentNumber: cell('enrollmentNumber'),
    enrollmentTrack: cell('enrollmentTrack'),
    status: statusLabel ? mapStatusFromLabel(statusLabel) : null
  };
}

/**
 * Validate member data for import
 */
function validateImportRow(member, rowIndex, bureauInImport, bureauMap, stats) {
  if (!member.firstName || !member.lastName || !member.email) {
    stats.errors.push(`Row ${rowIndex}: Missing required fields`);
    stats.skipped++;
    return false;
  }

  if (!isValidEmail(member.email)) {
    stats.errors.push(`Row ${rowIndex}: Invalid email format`);
    stats.skipped++;
    return false;
  }

  if (BUREAU_POSITIONS.includes(member.status)) {
    if (bureauInImport[member.status]) {
      stats.errors.push(`Row ${rowIndex}: Role ${STATUS_LABELS[member.status]} already assigned in this import`);
      stats.skipped++;
      return false;
    }

    const existing = bureauMap.get(member.status);
    if (existing && existing.email !== member.email) {
      stats.errors.push(`Row ${rowIndex}: Role ${STATUS_LABELS[member.status]} already held by ${existing.first_name} ${existing.last_name}`);
      stats.skipped++;
      return false;
    }

    bureauInImport[member.status] = member.email;
  }

  return true;
}

/**
 * Import or update a single member
 */
async function importOrUpdateMember(database, member, stats) {
  const existingMember = await database.prepare('SELECT id FROM members WHERE email = ?')
    .bind(member.email).first();

  if (existingMember) {
    await database.prepare(`
      UPDATE members SET
        first_name = ?, last_name = ?,
        phone = COALESCE(?, phone), student_id = COALESCE(?, student_id),
        enrollment_number = COALESCE(?, enrollment_number),
        enrollment_track = COALESCE(?, enrollment_track),
        status = COALESCE(?, status), updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(
      member.firstName, member.lastName, member.phone, member.studentId,
      member.enrollmentNumber, member.enrollmentTrack, member.status, existingMember.id
    ).run();
    stats.updated++;
  } else {
    const status = member.status ?? 'active';
    const now = new Date();
    const year = now.getMonth() >= 8 ? now.getFullYear() + 1 : now.getFullYear();
    const isApproved = status !== 'pending' && status !== 'rejected';
    const expiresAt = isApproved ? `${year}-08-31` : null;

    await database.prepare(`
      INSERT INTO members (first_name, last_name, email, phone, student_id,
        enrollment_number, enrollment_track, status, approved_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      member.firstName, member.lastName, member.email, member.phone, member.studentId,
      member.enrollmentNumber, member.enrollmentTrack ?? 'Autre', status,
      isApproved ? new Date().toISOString() : null, expiresAt
    ).run();
    stats.imported++;
  }
}

/**
 * Import members from CSV
 * POST /api/admin/import
 * Expected CSV headers: Prénom, Nom, Email, Téléphone, Numéro, Filière d'inscription, Statut
 */
export const importCSV = adminOnly(async (request, env) => {
  try {
    const body = await readJsonObject(request);
    if (!body) {
      return error(INVALID_BODY, 400);
    }
    const { csv: csvData } = body;

    if (!csvData || typeof csvData !== 'string') {
      return error('CSV data is required', 400);
    }

    const rows = parseCSV(csvData);
    if (rows.length < 2) {
      return error('CSV must contain at least a header and one data row', 400);
    }

    const headerMap = parseCSVHeaders(rows[0]);

    if (headerMap.firstName === undefined || headerMap.lastName === undefined || headerMap.email === undefined) {
      return error('CSV must have Prénom, Nom, and Email columns', 400);
    }

    const stats = { imported: 0, updated: 0, skipped: 0, errors: [] };
    const bureauInImport = {};

    // Pre-load existing bureau positions
    const existingBureau = await env.DB.prepare(
      `SELECT status, first_name, last_name, email FROM members WHERE status IN (${BUREAU_POSITIONS.map(() => '?').join(',')})`
    ).bind(...BUREAU_POSITIONS).all();

    const bureauMap = new Map();
    for (const m of existingBureau.results || []) {
      bureauMap.set(m.status, m);
    }

    for (let i = 1; i < rows.length; i++) {
      const member = extractMemberFromRow(rows[i], headerMap);
      if (!validateImportRow(member, i + 1, bureauInImport, bureauMap, stats)) continue;

      try {
        await importOrUpdateMember(env.DB, member, stats);
      } catch (error_) {
        console.error(`Import error row ${i + 1}:`, error_);
        stats.errors.push(`Row ${i + 1}: ${error_.message}`);
        stats.skipped++;
      }
    }

    return json({
      success: true,
      stats: { imported: stats.imported, updated: stats.updated, skipped: stats.skipped, total: stats.imported + stats.updated + stats.skipped },
      errors: stats.errors.length > 0 ? stats.errors.slice(0, 10) : undefined
    });
  } catch (error_) {
    console.error('Import CSV error:', error_);
    return error('Failed to import CSV: ' + error_.message, 500);
  }
});
