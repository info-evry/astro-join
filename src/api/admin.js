/**
 * Admin API endpoints for membership management (members, stats, settings).
 * CSV import/export lives in ./admin-csv.js.
 *
 * Error bodies are `{ error, code }` (astro-core/http). Every multi-statement
 * write goes through ONE `db.batch`, which D1 runs as a transaction: a failure
 * (duplicate email, ...) leaves nothing half-applied.
 */

import { json, success } from 'astro-core/router';
import { badRequest, conflict, invalidId, notFound, serverError } from 'astro-core/http';
import { readJsonOrRespond, isUniqueConstraintError } from 'astro-core/request';
import { parsePositiveId, parseIdList } from 'astro-core/ids';
import { chunk, inClause, SAFE_IDS_PER_STATEMENT } from 'astro-core/d1';
import { isValidEmail, isTooLong, LIMITS } from 'astro-core/validation';
import { validateSettings, isBooleanLike, isAcademicYear, isStringArray } from 'astro-core/settings';
import { adminHandler } from '../lib/admin-auth.js';
import { loadMembershipConfig, parseSettingRows } from '../lib/config.js';
import { ACTIVE_STATUSES_SQL, countMembers } from '../lib/member-stats.js';
import { sqlList } from '../lib/sql.js';
import {
  BATCH_STATUSES,
  BUREAU_ROLES,
  MAX_BATCH_IDS,
  MAX_ENROLLMENT_TRACKS,
  MAX_TRACK_LENGTH,
  STATUS_LABELS,
  VALID_STATUSES,
  approvalDates,
  isUniqueBureauRole,
  isValidStatus,
  normalizeEmail,
  statusLabel
} from '../shared/membership.js';

const MEMBER_NOT_FOUND = 'Membre introuvable';
const DEFAULT_STATUS_REASON = 'Status updated by admin';
const DEFAULT_BATCH_REASON = 'Batch update by admin';

const BUREAU_SQL = sqlList(BUREAU_ROLES);

/**
 * Get all members with stats
 * GET /api/admin/members
 */
export const getMembers = adminHandler(async (request, env) => {
  try {
    const members = await env.DB.prepare('SELECT * FROM members ORDER BY created_at DESC').all();
    return json({ members: members.results || [], stats: await countMembers(env.DB) });
  } catch (error_) {
    return serverError('Get members error:', error_);
  }
});

/**
 * Get admin dashboard stats
 * GET /api/admin/stats
 */
export const adminStats = adminHandler(async (request, env) => {
  try {
    const stats = await countMembers(env.DB);

    const bureau = await env.DB.prepare(`
      SELECT id, first_name, last_name, email, status
      FROM members
      WHERE status IN (${BUREAU_SQL})
    `).all();

    const tracks = await env.DB.prepare(`
      SELECT enrollment_track, COUNT(*) as count
      FROM members
      WHERE status IN (${ACTIVE_STATUSES_SQL})
      GROUP BY enrollment_track
      ORDER BY count DESC
    `).all();

    const recent = await env.DB.prepare(`
      SELECT * FROM members
      WHERE status = 'pending'
      ORDER BY created_at DESC
      LIMIT 10
    `).all();

    return json({
      stats,
      bureau: (bureau.results || [])
        .sort((a, b) => BUREAU_ROLES.indexOf(a.status) - BUREAU_ROLES.indexOf(b.status))
        .map((member) => ({ ...member, statusLabel: statusLabel(member.status) })),
      trackDistribution: tracks.results || [],
      recentApplications: recent.results || [],
      statusLabels: STATUS_LABELS,
      validStatuses: VALID_STATUSES
    });
  } catch (error_) {
    return serverError('Admin stats error:', error_);
  }
});

/**
 * Editable text columns of PUT /api/admin/members/:id.
 * `required` ones can never be null or blank; the others store blank as NULL.
 */
const FIELDS = [
  { key: 'firstName', column: 'first_name', label: 'Prénom', max: LIMITS.name, required: true },
  { key: 'lastName', column: 'last_name', label: 'Nom', max: LIMITS.name, required: true },
  { key: 'email', column: 'email', label: 'Email', max: LIMITS.email, required: true },
  { key: 'studentId', column: 'student_id', label: 'Numéro étudiant', max: LIMITS.studentId },
  { key: 'enrollmentTrack', column: 'enrollment_track', label: 'Cursus', max: MAX_TRACK_LENGTH, required: true },
  { key: 'phone', column: 'phone', label: 'Téléphone', max: LIMITS.phone },
  { key: 'telegram', column: 'telegram', label: 'Telegram', max: LIMITS.handle },
  { key: 'discord', column: 'discord', label: 'Discord', max: LIMITS.handle },
  { key: 'enrollmentNumber', column: 'enrollment_number', label: "Numéro d'inscription", max: LIMITS.studentId },
  { key: 'notes', column: 'notes', label: 'Notes', max: LIMITS.text }
];

/** Problem with one editable field of the body, or null. Lengths are measured after trimming. */
function fieldProblem(field, value) {
  if (value === null) return field.required ? `${field.label} : ne peut pas être nul` : null;
  if (typeof value !== 'string') return `${field.label} : doit être une chaîne de caractères`;
  if (field.required && !value.trim()) return `${field.label} : ne peut pas être vide`;
  if (isTooLong(value.trim(), field.max)) return `${field.label} : trop long (${field.max} caractères maximum)`;
  return null;
}

/**
 * Validate the shape of an update body (no database access).
 * @returns {string | null} the first problem found
 */
function validateUpdateBody(body) {
  for (const field of FIELDS) {
    if (body[field.key] === undefined) continue;
    const problem = fieldProblem(field, body[field.key]);
    if (problem) return problem;
  }
  if (body.email !== undefined && !isValidEmail(body.email)) return 'Email : format invalide';
  const { reason } = body;
  if (reason !== undefined && reason !== null && typeof reason !== 'string') return 'Motif : doit être une chaîne de caractères';
  if (isTooLong(reason, LIMITS.text)) return `Motif : trop long (${LIMITS.text} caractères maximum)`;
  return null;
}

/** Stored form of an editable value: trimmed, blank optional -> NULL, email normalised. */
function storedValue(field, value) {
  if (field.key === 'email') return normalizeEmail(value);
  const trimmed = typeof value === 'string' ? value.trim() : null;
  return field.required ? trimmed : trimmed || null;
}

/**
 * Update a member: fields and/or status
 * PUT /api/admin/members/:id
 */
export const updateMember = adminHandler(async (request, env, ctx, params) => {
  try {
    const memberId = parsePositiveId(params.id);
    if (memberId === null) return invalidId();

    const { data: body, response } = await readJsonOrRespond(request);
    if (response) return response;
    const problem = validateUpdateBody(body);
    if (problem) return badRequest(problem, 'invalid_field');

    const current = await env.DB.prepare('SELECT * FROM members WHERE id = ?').bind(memberId).first();
    if (!current) return notFound(MEMBER_NOT_FOUND);

    const trackProblem = await enrollmentTrackProblem(env.DB, body.enrollmentTrack, current);
    if (trackProblem) return badRequest(trackProblem, 'invalid_track');
    if (body.status !== undefined && !isValidStatus(body.status)) {
      return badRequest(`Statut invalide. Valeurs possibles : ${VALID_STATUSES.join(', ')}`, 'invalid_status');
    }

    const plan = planMemberUpdate(env.DB, memberId, body, current);
    if (!plan) return badRequest('Aucune modification fournie', 'no_changes');

    const results = await env.DB.batch(plan.statements);
    if (results[0].meta.changes === 0) return updateRefusal(env.DB, memberId, plan);
    return success('Membre mis à jour');
  } catch (error_) {
    if (isUniqueConstraintError(error_)) return conflict('Cet email est déjà utilisé par un autre membre');
    return serverError('Update member error:', error_);
  }
});

/**
 * The track must be one of the configured ones, except that a member may keep
 * a track they already have (imported or legacy data outside the list).
 * @returns {Promise<string | null>} a problem, or null
 */
async function enrollmentTrackProblem(db, track, current) {
  if (track === undefined || track === current.enrollment_track) return null;
  const { enrollmentTracks } = await loadMembershipConfig(db);
  return enrollmentTracks.includes(track.trim()) ? null : 'Cursus : valeur non proposée';
}

/**
 * Build the statements of one member update: the UPDATE first (so its
 * `meta.changes` is `results[0]`), then the history row when the status changes.
 * A change to a unique bureau role is guarded INSIDE the UPDATE, so two
 * concurrent requests can never both take the role and a refused assignment
 * writes nothing at all (neither fields, nor history).
 * @returns {{ statements: object[], role: string | null } | null} null when there is nothing to update
 */
function planMemberUpdate(db, memberId, body, current) {
  const sets = [];
  const values = [];
  for (const field of FIELDS) {
    if (body[field.key] === undefined) continue;
    sets.push(`${field.column} = ?`);
    values.push(storedValue(field, body[field.key]));
  }
  if (sets.length === 0 && body.status === undefined) return null;

  const statusChanged = body.status !== undefined && body.status !== current.status;
  let guard = '';
  let role = null;
  const guardValues = [];
  if (statusChanged) {
    sets.push('status = ?');
    values.push(body.status);
    const dates = approvalDates(current.status, body.status);
    if (dates) {
      sets.push('approved_at = ?', 'expires_at = ?');
      values.push(dates.approvedAt, dates.expiresAt);
    }
    if (isUniqueBureauRole(body.status)) {
      role = body.status;
      guard = ' AND NOT EXISTS (SELECT 1 FROM members WHERE status = ? AND id != ?)';
      guardValues.push(role, memberId);
    }
  }

  const statements = [
    db.prepare(`UPDATE members SET ${[...sets, 'updated_at = CURRENT_TIMESTAMP'].join(', ')} WHERE id = ?${guard}`)
      .bind(...values, memberId, ...guardValues)
  ];
  if (statusChanged) {
    // Only inserted when the UPDATE above really moved the member to the new
    // status (a refused role leaves the member in its old one).
    statements.push(db.prepare(`
      INSERT INTO membership_history (member_id, old_status, new_status, reason)
      SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM members WHERE id = ? AND status = ?)
    `).bind(memberId, current.status, body.status, body.reason || DEFAULT_STATUS_REASON, memberId, body.status));
  }
  return { statements, role };
}

/**
 * The UPDATE matched nothing: the unique bureau role is held by someone else,
 * or the member was deleted in the meantime.
 */
async function updateRefusal(db, memberId, plan) {
  if (plan.role) {
    const holder = await db.prepare('SELECT first_name, last_name FROM members WHERE status = ? AND id != ?')
      .bind(plan.role, memberId).first();
    if (holder) {
      return conflict(`Le rôle ${statusLabel(plan.role)} est déjà attribué à ${holder.first_name} ${holder.last_name}`);
    }
  }
  return notFound(MEMBER_NOT_FOUND);
}

/**
 * Delete member
 * DELETE /api/admin/members/:id
 */
export const deleteMember = adminHandler(async (request, env, ctx, params) => {
  try {
    const memberId = parsePositiveId(params.id);
    if (memberId === null) return invalidId();

    const result = await env.DB.prepare('DELETE FROM members WHERE id = ?').bind(memberId).run();
    if (result.meta.changes === 0) return notFound(MEMBER_NOT_FOUND);
    return success('Membre supprimé');
  } catch (error_) {
    return serverError('Delete member error:', error_);
  }
});

/**
 * Parse an id list from a request body.
 * @returns {{ ids: number[] } | { response: Response }}
 */
function readIdList(value) {
  const parsed = parseIdList(value, { max: MAX_BATCH_IDS });
  if ('ids' in parsed) return parsed;
  switch (parsed.error) {
    case 'invalid_id': {
      return { response: invalidId('Les identifiants doivent être des entiers positifs') };
    }
    case 'too_many': {
      return { response: badRequest(`Trop de membres (maximum ${MAX_BATCH_IDS})`, 'too_many_ids') };
    }
    default: {
      return { response: badRequest('Aucun membre spécifié', 'no_members') };
    }
  }
}

/**
 * Statements applying a batch status change to one chunk of ids: the history
 * INSERT (it reads the previous status, so it must run first; it skips members
 * that already have the new status) and the UPDATE(s). Ids that do not exist
 * are simply not matched. Moving to `active` only (re)approves members who
 * were not active already: the others keep their approval and expiry dates.
 * @returns {{ history: object, updates: object[] }}
 */
function batchChunkStatements(db, ids, status, reason, now) {
  const placeholders = inClause(ids.length);
  const history = db.prepare(`
    INSERT INTO membership_history (member_id, old_status, new_status, reason)
    SELECT id, status, ?, ? FROM members WHERE id IN (${placeholders}) AND status != ?
  `).bind(status, reason || DEFAULT_BATCH_REASON, ...ids, status);

  const touch = 'status = ?, updated_at = CURRENT_TIMESTAMP';
  const target = `id IN (${placeholders})`;
  const dates = approvalDates(null, status, now);
  if (!dates) {
    return { history, updates: [db.prepare(`UPDATE members SET ${touch} WHERE ${target}`).bind(status, ...ids)] };
  }
  return {
    history,
    // Order matters: the first UPDATE moves already-active members to `active`
    // (dates untouched), so the second one only sees the members that were not active.
    updates: [
      db.prepare(`UPDATE members SET ${touch} WHERE ${target} AND status IN (${ACTIVE_STATUSES_SQL})`).bind(status, ...ids),
      db.prepare(`UPDATE members SET ${touch}, approved_at = ?, expires_at = ? WHERE ${target} AND status NOT IN (${ACTIVE_STATUSES_SQL})`)
        .bind(status, dates.approvedAt, dates.expiresAt, ...ids)
    ]
  };
}

/**
 * Batch approve/reject/expire members
 * POST /api/admin/members/batch
 */
export const batchUpdateMembers = adminHandler(async (request, env) => {
  try {
    const { data: body, response } = await readJsonOrRespond(request);
    if (response) return response;

    const list = readIdList(body.memberIds);
    if (list.response) return list.response;
    if (!BATCH_STATUSES.includes(body.status)) {
      return badRequest(`Statut invalide. Valeurs possibles : ${BATCH_STATUSES.join(', ')}`, 'invalid_status');
    }
    const { reason } = body;
    if (reason !== undefined && reason !== null && typeof reason !== 'string') {
      return badRequest('Motif : doit être une chaîne de caractères', 'invalid_field');
    }
    if (isTooLong(reason, LIMITS.text)) {
      return badRequest(`Motif : trop long (${LIMITS.text} caractères maximum)`, 'invalid_field');
    }

    const now = new Date();
    const statements = [];
    const updateIndexes = [];
    for (const part of chunk(list.ids, SAFE_IDS_PER_STATEMENT)) {
      const { history, updates } = batchChunkStatements(env.DB, part, body.status, reason, now);
      statements.push(history);
      for (const update of updates) {
        updateIndexes.push(statements.length);
        statements.push(update);
      }
    }
    const results = await env.DB.batch(statements);

    const updated = updateIndexes.reduce((total, index) => total + (Number(results[index]?.meta?.changes) || 0), 0);
    if (updated === 0) return notFound('Aucun membre correspondant');
    return success(`${updated} membre(s) mis à jour`, { updated });
  } catch (error_) {
    return serverError('Batch update error:', error_);
  }
});

/**
 * Batch delete members (history rows cascade)
 * DELETE /api/admin/members/batch  { ids: number[] }
 */
export const deleteMembersBatch = adminHandler(async (request, env) => {
  try {
    const { data: body, response } = await readJsonOrRespond(request);
    if (response) return response;

    const list = readIdList(body.ids);
    if (list.response) return list.response;

    // One atomic batch. The rows are counted through RETURNING: `meta.changes`
    // would also count the history rows removed by the ON DELETE CASCADE.
    const results = await env.DB.batch(chunk(list.ids, SAFE_IDS_PER_STATEMENT).map((part) =>
      env.DB.prepare(`DELETE FROM members WHERE id IN (${inClause(part.length)}) RETURNING id`).bind(...part)
    ));
    const deleted = results.reduce((total, result) => total + (result.results?.length ?? 0), 0);
    if (deleted === 0) return notFound('Aucun membre correspondant');
    return success(`${deleted} membre(s) supprimé(s)`, { deleted });
  } catch (error_) {
    return serverError('Batch delete error:', error_);
  }
});

/**
 * Get settings. Values come back parsed: booleans are real booleans and
 * `enrollment_tracks` a real array (a value that is not JSON is returned as text).
 * GET /api/admin/settings
 */
export const getSettings = adminHandler(async (request, env) => {
  try {
    const { results } = await env.DB.prepare('SELECT key, value FROM settings').all();
    return json({ settings: parseSettingRows(results || []) });
  } catch (error_) {
    return serverError('Get settings error:', error_);
  }
});

/**
 * Settings keys the admin API accepts, each with its validator
 * (astro-core/settings: `true` accepts, anything else rejects).
 */
const SETTINGS_SCHEMA = {
  membership_open: isBooleanLike,
  current_year: isAcademicYear,
  enrollment_tracks: isStringArray({ minItems: 1, maxItems: MAX_ENROLLMENT_TRACKS, maxLength: MAX_TRACK_LENGTH })
};

/** Message naming the unknown and the invalid keys of a rejected settings body. */
function settingsProblem({ unknown, invalid }) {
  const parts = [];
  if (unknown.length > 0) parts.push(`Paramètre(s) inconnu(s) : ${unknown.join(', ')}`);
  if (invalid.length > 0) parts.push(`Valeur invalide pour : ${invalid.flatMap((entry) => Object.keys(entry)).join(', ')}`);
  return parts.join(' ; ');
}

/**
 * Update settings (any subset of the keys above, written in one batch)
 * PUT /api/admin/settings
 */
export const updateSettings = adminHandler(async (request, env) => {
  try {
    const { data: body, response } = await readJsonOrRespond(request);
    if (response) return response;

    const result = validateSettings(body, SETTINGS_SCHEMA);
    if (!result.ok) return badRequest(settingsProblem(result), 'invalid_settings');
    if (result.entries.length === 0) return success('Paramètres enregistrés');

    await env.DB.batch(result.entries.map(([key, value]) =>
      env.DB.prepare(`
        INSERT OR REPLACE INTO settings (key, value, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
      `).bind(key, typeof value === 'object' ? JSON.stringify(value) : String(value))
    ));
    return success('Paramètres enregistrés');
  } catch (error_) {
    return serverError('Update settings error:', error_);
  }
});
