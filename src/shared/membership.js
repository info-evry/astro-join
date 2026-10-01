/**
 * Membership model shared by the Worker (src/api, src/lib) and the browser
 * (src/client). Pure data and pure functions: no imports, no DOM, no Worker
 * APIs, so every consumer sees one definition of "a status", "an active
 * member" or "the end of the academic year".
 *
 * Status vocabulary
 * -----------------
 * `members.status` is a plain TEXT column (db/schema.sql has no CHECK
 * constraint), so the database accepts any value; the API only ever writes the
 * ones listed in `STATUS_LABELS`. Both `honorary_president` and
 * `vice_president` are real statuses (documented in db/migrate-001-member-roles.sql);
 * the `bureau_positions` table created by that migration is reserved and not
 * read by anyone: role uniqueness is enforced by the application with an
 * atomic `UPDATE ... WHERE NOT EXISTS (...)` (see src/api/admin.js).
 *
 * Bureau
 * ------
 * - `BUREAU_ROLES`: the five officer statuses, in display order (this is the
 *   order the dashboard's Bureau tab and `/api/admin/stats` list them in).
 * - `UNIQUE_BUREAU_ROLES`: the four that can only be held by one member at a
 *   time. `honorary_president` is deliberately NOT unique: several honorary
 *   presidents may coexist.
 *
 * Active members
 * --------------
 * `ACTIVE_STATUSES` is the ONE definition of "counts as an active member":
 * `active`, `honor` and every bureau role. `/api/stats`, the admin members
 * list and the admin stats all count with it, and a member entering this set
 * from outside it is (re)approved (see `approvalDates`).
 */

/** Academic year used until an admin configures `current_year`. Keep in sync with db/schema.sql (a test checks it). */
export const DEFAULT_ACADEMIC_YEAR = '2024-2025';

/** Tracks offered (and accepted) until an admin configures `enrollment_tracks`. */
export const DEFAULT_ENROLLMENT_TRACKS = Object.freeze([
  'L1 Informatique',
  'L2 Informatique',
  'L3 Informatique',
  'M1 Informatique',
  'M2 Informatique',
  'Autre'
]);

/** Bounds of the `enrollment_tracks` setting (shared by the validator and the member forms). */
export const MAX_ENROLLMENT_TRACKS = 20;
export const MAX_TRACK_LENGTH = 60;

/**
 * French display label of every status. The key order is the canonical order
 * of `VALID_STATUSES`.
 */
export const STATUS_LABELS = Object.freeze({
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
});

/** Every status the API reads and writes. */
export const VALID_STATUSES = Object.freeze(Object.keys(STATUS_LABELS));

/** Officer statuses in display order. */
export const BUREAU_ROLES = Object.freeze([
  'president',
  'vice_president',
  'secretary',
  'treasurer',
  'honorary_president'
]);

/** Officer statuses held by at most one member at a time (all but `honorary_president`). */
export const UNIQUE_BUREAU_ROLES = Object.freeze(['president', 'vice_president', 'secretary', 'treasurer']);

/** Statuses that count as an active member: active, honor and the bureau. */
export const ACTIVE_STATUSES = Object.freeze(['active', 'honor', ...BUREAU_ROLES]);

/** Statuses an admin batch request may apply. */
export const BATCH_STATUSES = Object.freeze(['active', 'rejected', 'expired']);

/** Most ids one admin batch request (status change or delete) accepts; the client splits bigger selections. */
export const MAX_BATCH_IDS = 1000;

const ACTIVE_SET = new Set(ACTIVE_STATUSES);
const BUREAU_SET = new Set(BUREAU_ROLES);
const UNIQUE_SET = new Set(UNIQUE_BUREAU_ROLES);
const VALID_SET = new Set(VALID_STATUSES);

/** @param {unknown} status */
export const isValidStatus = (status) => typeof status === 'string' && VALID_SET.has(status);

/** @param {unknown} status */
export const isActiveStatus = (status) => typeof status === 'string' && ACTIVE_SET.has(status);

/** @param {unknown} status */
export const isBureauRole = (status) => typeof status === 'string' && BUREAU_SET.has(status);

/** @param {unknown} status */
export const isUniqueBureauRole = (status) => typeof status === 'string' && UNIQUE_SET.has(status);

/** Display label of a status; the raw value for an unknown one. */
export function statusLabel(status) {
  return Object.hasOwn(STATUS_LABELS, status) ? STATUS_LABELS[status] : String(status ?? '');
}

/**
 * Comparison form of a status name or label: no accents, lower case, hyphens,
 * underscores and runs of spaces collapsed, typographic apostrophes straightened.
 */
function labelKey(value) {
  return String(value)
    .normalize('NFD')
    .replaceAll(/\p{M}/gu, '')
    .toLowerCase()
    .replaceAll('’', "'")
    .replaceAll(/[-_\s]+/g, ' ')
    .trim();
}

/** Short forms an admin may type besides the full label. */
const LABEL_ALIASES = { actif: 'active', honneur: 'honor' };

/** labelKey -> status, built from the status names, the labels and the aliases. */
const STATUS_BY_KEY = new Map([
  ...VALID_STATUSES.map((status) => [labelKey(status), status]),
  ...Object.entries(STATUS_LABELS).map(([status, label]) => [labelKey(label), status]),
  ...Object.entries(LABEL_ALIASES).map(([alias, status]) => [labelKey(alias), status])
]);

/**
 * Status for a CSV "Statut" cell: an internal value (`vice_president`), a
 * French label (`Vice-président`) or a short form (`actif`), compared
 * ignoring case, accents and hyphen/space differences.
 * @param {unknown} label
 * @returns {string | null} the status, or null when the text names no status
 */
export function statusFromLabel(label) {
  if (typeof label !== 'string') return null;
  return STATUS_BY_KEY.get(labelKey(label)) ?? null;
}

/**
 * Last day of the academic year containing `date`: 31 August, of the next
 * calendar year from September on (UTC, like every other timestamp here).
 * @param {Date | string | number} [date]
 * @returns {string} `YYYY-08-31`
 */
export function expiryDateFor(date = new Date()) {
  const when = new Date(date);
  const year = when.getUTCMonth() >= 8 ? when.getUTCFullYear() + 1 : when.getUTCFullYear();
  return `${year}-08-31`;
}

/**
 * Timestamp in the format SQLite's CURRENT_TIMESTAMP produces
 * (`YYYY-MM-DD HH:MM:SS`, UTC), so `approved_at` matches `created_at` and
 * `updated_at`.
 * @param {Date | string | number} [date]
 * @returns {string}
 */
export function sqlTimestamp(date = new Date()) {
  return new Date(date).toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Approval bookkeeping for a status change. A member entering the active set
 * from outside it (pending, rejected, expired, ...) is approved now and expires
 * at the end of the academic year; moving between active statuses, or to a
 * non-active one, leaves the dates alone.
 * @param {string | null | undefined} oldStatus status before the change (null for a new member)
 * @param {string} newStatus
 * @param {Date | string | number} [now]
 * @returns {{ approvedAt: string, expiresAt: string } | null}
 */
export function approvalDates(oldStatus, newStatus, now = new Date()) {
  if (!isActiveStatus(newStatus) || isActiveStatus(oldStatus)) return null;
  return { approvedAt: sqlTimestamp(now), expiresAt: expiryDateFor(now) };
}

/**
 * Canonical form of an email address: trimmed and lower-cased. Every path
 * (application, admin edit, CSV import) stores and looks up this form.
 * @param {unknown} email
 * @returns {string}
 */
export function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}
