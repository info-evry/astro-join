/**
 * Admin CSV export and import.
 *
 * Export: `;`-separated with a UTF-8 BOM (what French Excel opens correctly).
 * Import: accepts `,` `;` or TAB (detected from the header line), the old comma
 * exports and the new ones, and strips the formula-injection guard that
 * `generateCsv` adds, so export -> import is a round trip.
 */

import { json } from 'astro-core/router';
import { badRequest, serverError } from 'astro-core/http';
import { readJsonOrRespond, isUniqueConstraintError } from 'astro-core/request';
import { chunk, inClause, SAFE_IDS_PER_STATEMENT } from 'astro-core/d1';
import { csvResponse, generateCsv, mapCsvHeaders, parseCsv, unescapeCsvCell } from 'astro-core/csv';
import { isValidEmail, isTooLong, LIMITS } from 'astro-core/validation';
import { adminHandler } from '../lib/admin-auth.js';
import { sqlList } from '../lib/sql.js';
import {
  BUREAU_ROLES,
  MAX_TRACK_LENGTH,
  UNIQUE_BUREAU_ROLES,
  VALID_STATUSES,
  approvalDates,
  isUniqueBureauRole,
  isValidStatus,
  normalizeEmail,
  statusFromLabel,
  statusLabel
} from '../shared/membership.js';

/** Most data rows one import accepts (a Worker invocation has a bounded number of subrequests). */
export const MAX_IMPORT_ROWS = 2000;
/** Rows written per `db.batch` (each row is one or two statements). */
const ROWS_PER_BATCH = 25;
/** Errors listed in the response; every skipped row is still counted. */
const MAX_REPORTED_ERRORS = 10;
const IMPORT_REASON = 'Imported from CSV';
/** Pseudo status accepted by the export filter: every bureau role. */
const BUREAU_FILTER = 'bureau';

/** Export columns, in order. `key` is the `members` column. */
const EXPORT_COLUMNS = [
  { header: 'ID', key: 'id' },
  { header: 'Prénom', key: 'first_name' },
  { header: 'Nom', key: 'last_name' },
  { header: 'Email', key: 'email' },
  { header: 'Numéro étudiant', key: 'student_id' },
  { header: 'Numéro inscription', key: 'enrollment_number' },
  { header: 'Cursus', key: 'enrollment_track' },
  { header: 'Téléphone', key: 'phone' },
  { header: 'Telegram', key: 'telegram' },
  { header: 'Discord', key: 'discord' },
  { header: 'Statut', key: 'status' },
  { header: 'Notes', key: 'notes' },
  { header: 'Date adhésion', key: 'created_at' },
  { header: 'Date approbation', key: 'approved_at' },
  { header: 'Date expiration', key: 'expires_at' }
];

/**
 * Export members to CSV
 * GET /api/admin/export[?status=<status>|bureau]
 */
export const exportMembers = adminHandler(async (request, env) => {
  try {
    const status = new URL(request.url).searchParams.get('status') || null;
    if (status !== null && status !== BUREAU_FILTER && !isValidStatus(status)) {
      return badRequest(`Statut invalide. Valeurs possibles : ${VALID_STATUSES.join(', ')}`, 'invalid_status');
    }

    let filter = '';
    if (status === BUREAU_FILTER) filter = ` WHERE status IN (${sqlList(BUREAU_ROLES)})`;
    else if (status !== null) filter = ' WHERE status = ?';
    const statement = env.DB.prepare(`SELECT * FROM members${filter} ORDER BY last_name, first_name`);
    const members = await (status !== null && status !== BUREAU_FILTER ? statement.bind(status) : statement).all();

    const content = generateCsv(members.results || [], { columns: EXPORT_COLUMNS, delimiter: ';', bom: true });
    return csvResponse(content, status ? `members_${status}.csv` : 'members.csv');
  } catch (error_) {
    return serverError('Export error:', error_);
  }
});

/** Accepted header names per field (lower case; compared ignoring case and surrounding spaces). */
const HEADER_ALIASES = {
  firstName: ['prénom', 'prenom', 'firstname'],
  lastName: ['nom', 'lastname'],
  email: ['email', 'mail'],
  phone: ['téléphone', 'telephone', 'phone', 'tel'],
  studentId: ['numéro étudiant', 'numero etudiant', 'n° étudiant', 'student_id', 'numéro', 'numero'],
  enrollmentNumber: [
    'numéro inscription', 'numero inscription', 'n° inscription',
    "numéro d'inscription", "numero d'inscription", 'numéro d’inscription', 'enrollment_number'
  ],
  enrollmentTrack: ["filière d'inscription", 'filiere', 'track', 'enrollment_track', 'cursus'],
  telegram: ['telegram'],
  discord: ['discord'],
  notes: ['notes', 'note', 'commentaire'],
  status: ['statut', 'status']
};

/** Text fields of an import row: label and length cap, for the "too long" check. */
const IMPORT_LIMITS = [
  ['firstName', 'prénom', LIMITS.name],
  ['lastName', 'nom', LIMITS.name],
  ['email', 'email', LIMITS.email],
  ['phone', 'téléphone', LIMITS.phone],
  ['studentId', 'numéro étudiant', LIMITS.studentId],
  ['enrollmentNumber', "numéro d'inscription", LIMITS.studentId],
  ['enrollmentTrack', 'cursus', MAX_TRACK_LENGTH],
  ['telegram', 'Telegram', LIMITS.handle],
  ['discord', 'Discord', LIMITS.handle],
  ['notes', 'notes', LIMITS.text]
];

/**
 * One row of the file as typed: blank or absent cells are null (so they never
 * overwrite stored values) and the export's injection guard is removed.
 */
function extractRow(cells, headerMap) {
  const cell = (field) => {
    const index = headerMap[field];
    if (index === undefined) return null;
    return unescapeCsvCell(cells[index] ?? '').trim() || null;
  };
  const member = {};
  for (const field of Object.keys(HEADER_ALIASES)) member[field] = cell(field);
  member.email = member.email === null ? null : normalizeEmail(member.email);
  return member;
}

/** Why a row cannot be imported (French, without the "Ligne N" prefix), or null. Pure: no database access. */
function rowProblem(member) {
  if (!member.firstName || !member.lastName || !member.email) return 'champs obligatoires manquants (prénom, nom, email)';
  if (!isValidEmail(member.email)) return 'email invalide';
  if (member.status !== null && statusFromLabel(member.status) === null) {
    return `statut inconnu « ${member.status.slice(0, 40)} »`;
  }
  const tooLong = IMPORT_LIMITS.find(([field, , max]) => isTooLong(member[field], max));
  return tooLong ? `${tooLong[1]} trop long (${tooLong[2]} caractères maximum)` : null;
}

/**
 * Check a row's unique bureau role against the roles already held in the
 * database and already given earlier in the same file.
 * @returns {string | null} a problem, or null (the role is then recorded in `taken`)
 */
function roleProblem(member, status, holders, taken) {
  if (!isUniqueBureauRole(status)) return null;
  if (taken.has(status)) return `le rôle ${statusLabel(status)} est déjà attribué dans cet import`;
  const holder = holders.get(status);
  if (holder && holder.email !== member.email) {
    return `le rôle ${statusLabel(status)} est déjà détenu par ${holder.first_name} ${holder.last_name}`;
  }
  taken.set(status, member.email);
  return null;
}

/** History row for the member with this email (its id is only known to the database). */
function importHistory(db, email, oldStatus, newStatus) {
  return db.prepare(`
    INSERT INTO membership_history (member_id, old_status, new_status, reason)
    SELECT id, ?, ?, ? FROM members WHERE email = ?
  `).bind(oldStatus, newStatus, IMPORT_REASON, email);
}

/** Statements creating a member. */
function insertStatements(db, member, status) {
  const dates = approvalDates(null, status);
  const write = db.prepare(`
    INSERT INTO members (first_name, last_name, email, phone, student_id, enrollment_number,
      enrollment_track, telegram, discord, notes, status, approved_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    member.firstName, member.lastName, member.email, member.phone, member.studentId, member.enrollmentNumber,
    member.enrollmentTrack ?? 'Autre', member.telegram, member.discord, member.notes, status,
    dates?.approvedAt ?? null, dates?.expiresAt ?? null
  );
  return [write, importHistory(db, member.email, null, status)];
}

/** Statements updating the existing member with this email; blank cells keep the stored values. */
function updateStatements(db, member, oldStatus, status) {
  const newStatus = status ?? oldStatus;
  const dates = status ? approvalDates(oldStatus, status) : null;
  const write = db.prepare(`
    UPDATE members SET
      first_name = ?, last_name = ?,
      phone = COALESCE(?, phone), student_id = COALESCE(?, student_id),
      enrollment_number = COALESCE(?, enrollment_number),
      enrollment_track = COALESCE(?, enrollment_track),
      telegram = COALESCE(?, telegram), discord = COALESCE(?, discord), notes = COALESCE(?, notes),
      status = COALESCE(?, status),
      approved_at = COALESCE(?, approved_at), expires_at = COALESCE(?, expires_at),
      updated_at = CURRENT_TIMESTAMP
    WHERE email = ?
  `).bind(
    member.firstName, member.lastName, member.phone, member.studentId, member.enrollmentNumber,
    member.enrollmentTrack, member.telegram, member.discord, member.notes, status,
    dates?.approvedAt ?? null, dates?.expiresAt ?? null, member.email
  );
  return newStatus === oldStatus ? [write] : [write, importHistory(db, member.email, oldStatus, newStatus)];
}

/** Existing members (email -> { id, status }) among `emails`, read in batches. */
async function loadExistingMembers(db, emails) {
  const existing = new Map();
  if (emails.length === 0) return existing;
  const lookups = chunk(emails, SAFE_IDS_PER_STATEMENT).map((part) =>
    db.prepare(`SELECT id, email, status FROM members WHERE email IN (${inClause(part.length)})`).bind(...part)
  );
  for (const result of await db.batch(lookups)) {
    for (const row of result.results || []) existing.set(row.email, row);
  }
  return existing;
}

/** Current holders of the unique bureau roles (role -> member). */
async function loadRoleHolders(db) {
  const { results } = await db.prepare(
    `SELECT status, first_name, last_name, email FROM members WHERE status IN (${sqlList(UNIQUE_BUREAU_ROLES)})`
  ).all();
  return new Map((results || []).map((member) => [member.status, member]));
}

/**
 * Turn the parsed rows into write plans, collecting a row error instead of a
 * plan for every row that cannot be imported.
 * @returns {{ plans: Array<{ line: number, kind: 'imported' | 'updated', statements: object[] }>, errors: string[] }}
 */
async function planImport(db, rows, headerMap) {
  const members = rows.map((cells) => extractRow(cells, headerMap));
  const known = await loadExistingMembers(db, [...new Set(members.map((member) => member.email).filter(Boolean))]);
  const holders = await loadRoleHolders(db);
  const taken = new Map();
  const plans = [];
  const errors = [];

  for (const [index, member] of members.entries()) {
    const line = index + 2; // the header is line 1
    const problem = rowProblem(member);
    const status = member.status === null ? null : statusFromLabel(member.status);
    const error = problem ?? roleProblem(member, status, holders, taken);
    if (error) {
      errors.push(`Ligne ${line} : ${error}`);
      continue;
    }

    const existing = known.get(member.email);
    if (existing) {
      plans.push({ line, kind: 'updated', statements: updateStatements(db, member, existing.status, status) });
      known.set(member.email, { ...existing, status: status ?? existing.status });
    } else {
      const created = status ?? 'active';
      plans.push({ line, kind: 'imported', statements: insertStatements(db, member, created) });
      known.set(member.email, { email: member.email, status: created });
    }
  }
  return { plans, errors };
}

/** Run statements as one atomic batch; resolves to the error that rolled it back, or null. */
async function runBatch(db, statements) {
  try {
    await db.batch(statements);
    return null;
  } catch (error_) {
    return error_;
  }
}

/**
 * Write the plans in batches. A failing batch is rolled back as a whole, then
 * its rows are retried one by one so only the guilty rows are reported.
 */
async function writePlans(db, plans, stats) {
  for (const group of chunk(plans, ROWS_PER_BATCH)) {
    const failure = await runBatch(db, group.flatMap((plan) => plan.statements));
    if (!failure) {
      for (const plan of group) stats[plan.kind]++;
      continue;
    }
    console.error('Import batch failed, retrying row by row:', failure);

    for (const plan of group) {
      const rowFailure = await runBatch(db, plan.statements);
      if (rowFailure) {
        stats.skipped++;
        stats.errors.push(`Ligne ${plan.line} : ${rowWriteProblem(rowFailure)}`);
      } else {
        stats[plan.kind]++;
      }
    }
  }
}

/** Client-safe reason for a failed row write (never the database message). */
function rowWriteProblem(error_) {
  console.error('Import row failed:', error_);
  return isUniqueConstraintError(error_) ? 'email déjà utilisé par un autre membre' : 'enregistrement impossible';
}

/**
 * Parse the uploaded text into header map and data rows, or the 400 to answer.
 * @returns {{ headerMap: Record<string, number>, rows: string[][] } | { response: Response }}
 */
function readCsvInput(csv) {
  const { headers, rows } = parseCsv(csv);
  if (rows.length === 0) {
    return { response: badRequest('Le CSV doit contenir un en-tête et au moins une ligne de données', 'invalid_csv') };
  }
  if (rows.length > MAX_IMPORT_ROWS) {
    return { response: badRequest(`Trop de lignes (maximum ${MAX_IMPORT_ROWS})`, 'too_many_rows') };
  }
  const headerMap = mapCsvHeaders(headers, HEADER_ALIASES);
  if (headerMap.firstName === undefined || headerMap.lastName === undefined || headerMap.email === undefined) {
    return { response: badRequest('Le CSV doit contenir les colonnes Prénom, Nom et Email', 'missing_columns') };
  }
  return { headerMap, rows };
}

/**
 * Import members from CSV (existing members are matched by email and updated)
 * POST /api/admin/import   { csv: string }
 * Recognised headers: see HEADER_ALIASES (Prénom, Nom and Email are required).
 */
export const importCSV = adminHandler(async (request, env) => {
  try {
    const { data: body, response } = await readJsonOrRespond(request);
    if (response) return response;
    if (!body.csv || typeof body.csv !== 'string') return badRequest('Données CSV requises', 'csv_required');

    const input = readCsvInput(body.csv);
    if (input.response) return input.response;

    const { plans, errors } = await planImport(env.DB, input.rows, input.headerMap);
    const stats = { imported: 0, updated: 0, skipped: errors.length, errors };
    await writePlans(env.DB, plans, stats);

    return json({
      success: true,
      stats: {
        imported: stats.imported,
        updated: stats.updated,
        skipped: stats.skipped,
        total: stats.imported + stats.updated + stats.skipped
      },
      errors: errors.length > 0 ? errors.slice(0, MAX_REPORTED_ERRORS) : undefined
    });
  } catch (error_) {
    return serverError('Import CSV error:', error_);
  }
});
