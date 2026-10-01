/**
 * Membership application endpoint
 */

import { error, success } from 'astro-core/router';
import { badRequest, conflict, serverError } from 'astro-core/http';
import { readJsonOrRespond, isUniqueConstraintError } from 'astro-core/request';
import { isOneOf, isTooLong, isValidEmail, LIMITS } from 'astro-core/validation';
import { loadMembershipConfig } from '../lib/config.js';
import { normalizeEmail } from '../shared/membership.js';

const GENERIC_FAILURE = 'Une erreur est survenue. Veuillez réessayer.';
const PENDING_DUPLICATE = 'Une demande avec cet email est déjà en attente de validation.';
const MEMBERSHIP_CLOSED = "Les adhésions sont actuellement fermées. Revenez plus tard ou contactez l'association.";

/** Body fields of an application. */
const FIELDS = ['firstName', 'lastName', 'email', 'studentId', 'phone', 'telegram', 'discord', 'enrollmentTrack'];

/**
 * Submit a membership application
 * POST /api/apply
 */
export async function apply(request, env) {
  try {
    const config = await loadMembershipConfig(env.DB);
    if (!config.membershipOpen) return error(MEMBERSHIP_CLOSED, 403, 'membership_closed');

    const { data: body, response } = await readJsonOrRespond(request);
    if (response) return response;

    const data = readFields(body);
    const errors = validateApplication(data, config.enrollmentTracks);
    if (errors.length > 0) return badRequest(errors.join('; '), 'validation_error');

    // Normalise once so the duplicate lookup and the insert agree
    const email = normalizeEmail(data.email);
    const fields = [
      data.firstName.trim(),
      data.lastName.trim(),
      email,
      data.studentId.trim() || null,
      data.enrollmentTrack,
      data.phone.trim() || null,
      data.telegram.trim() || null,
      data.discord.trim() || null
    ];

    const existing = await env.DB.prepare('SELECT id, status FROM members WHERE email = ?').bind(email).first();
    if (existing?.status === 'pending') return conflict(PENDING_DUPLICATE);
    if (existing && existing.status !== 'rejected' && existing.status !== 'expired') {
      return conflict('Cet email est déjà associé à un membre actif.');
    }

    // Rejected/expired members re-apply by reopening their existing row
    // (email is UNIQUE, so a second INSERT would fail).
    const memberId = existing
      ? await reopenApplication(env.DB, existing, fields)
      : await insertApplication(env.DB, fields);

    return success(
      'Votre demande d\'adhésion a bien été enregistrée. Vous recevrez un email de confirmation une fois votre demande validée.',
      { memberId }
    );
  } catch (error_) {
    if (isUniqueConstraintError(error_)) {
      // Lost a race with a concurrent application for the same email
      return conflict(PENDING_DUPLICATE);
    }
    return serverError('Application error:', error_, GENERIC_FAILURE);
  }
}

/**
 * The application fields as strings: anything that is not a string (numbers,
 * arrays, objects) counts as absent, so it can never reach trim()/length checks.
 * @param {Record<string, unknown>} body
 * @returns {Record<string, string>}
 */
function readFields(body) {
  return Object.fromEntries(FIELDS.map((field) => [field, typeof body[field] === 'string' ? body[field] : '']));
}

/** History row of the application of the member with this email. */
function applicationHistory(db, email, oldStatus, reason) {
  return db.prepare(`
    INSERT INTO membership_history (member_id, old_status, new_status, reason)
    SELECT id, ?, 'pending', ? FROM members WHERE email = ?
  `).bind(oldStatus, reason, email);
}

/**
 * Insert a new pending application and log it in the history (one atomic batch).
 * @returns {Promise<number>} the new member id
 */
async function insertApplication(database, fields) {
  const results = await database.batch([
    database.prepare(`
      INSERT INTO members (
        first_name, last_name, email, student_id, enrollment_track,
        phone, telegram, discord, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `).bind(...fields),
    applicationHistory(database, fields[2], null, 'Application submitted')
  ]);
  return results[0].meta.last_row_id;
}

/**
 * Put a previously rejected/expired member back to pending with the
 * freshly submitted details (one atomic batch).
 * @returns {Promise<number>} the existing member id
 */
async function reopenApplication(database, existing, fields) {
  const [firstName, lastName, email, studentId, enrollmentTrack, phone, telegram, discord] = fields;
  await database.batch([
    database.prepare(`
      UPDATE members SET
        first_name = ?, last_name = ?, student_id = ?, enrollment_track = ?,
        phone = ?, telegram = ?, discord = ?, status = 'pending',
        approved_at = NULL, expires_at = NULL,
        created_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(firstName, lastName, studentId, enrollmentTrack, phone, telegram, discord, existing.id),
    applicationHistory(database, email, existing.status, 'Application re-submitted')
  ]);
  return existing.id;
}

/**
 * True if `value`, trimmed, is longer than `max`.
 * @param {string} value
 * @param {number} max
 */
function tooLong(value, max) {
  return isTooLong(value.trim(), max);
}

/**
 * Validate the required name/email fields, pushing errors as they're found.
 * @param {Record<string, string>} data
 * @param {string[]} errors
 */
function validateIdentityFields(data, errors) {
  if (!data.firstName.trim()) {
    errors.push('Le prénom est requis');
  } else if (tooLong(data.firstName, LIMITS.name)) {
    errors.push(`Le prénom est trop long (${LIMITS.name} caractères maximum)`);
  }

  if (!data.lastName.trim()) {
    errors.push('Le nom est requis');
  } else if (tooLong(data.lastName, LIMITS.name)) {
    errors.push(`Le nom est trop long (${LIMITS.name} caractères maximum)`);
  }

  if (!data.email.trim()) {
    errors.push('L\'email est requis');
  } else if (tooLong(data.email, LIMITS.email)) {
    errors.push(`L'email est trop long (${LIMITS.email} caractères maximum)`);
  } else if (!isValidEmail(data.email)) {
    errors.push('L\'email est invalide');
  }
}

/**
 * Validate the optional contact fields (phone/telegram/discord), including
 * the "at least one contact method" rule.
 * @param {Record<string, string>} data
 * @param {string[]} errors
 */
function validateContactFields(data, errors) {
  if (tooLong(data.phone, LIMITS.phone)) {
    errors.push(`Le numéro de téléphone est trop long (${LIMITS.phone} caractères maximum)`);
  }
  if (tooLong(data.telegram, LIMITS.handle)) {
    errors.push(`Le pseudo Telegram est trop long (${LIMITS.handle} caractères maximum)`);
  }
  if (tooLong(data.discord, LIMITS.handle)) {
    errors.push(`Le pseudo Discord est trop long (${LIMITS.handle} caractères maximum)`);
  }

  if (!data.phone.trim() && !data.telegram.trim() && !data.discord.trim()) {
    errors.push('Au moins un moyen de contact est requis');
  }
}

/**
 * Validate application data
 * @param {Record<string, string>} data - the fields, as strings
 * @param {string[]} enrollmentTracks - Currently configured enrollment tracks
 * @returns {string[]} one message per problem
 */
function validateApplication(data, enrollmentTracks) {
  const errors = [];

  if (tooLong(data.studentId, LIMITS.studentId)) {
    errors.push(`Le numéro étudiant est trop long (${LIMITS.studentId} caractères maximum)`);
  }

  validateIdentityFields(data, errors);

  if (!data.enrollmentTrack) {
    errors.push('Le cursus est requis');
  } else if (!isOneOf(data.enrollmentTrack, enrollmentTracks)) {
    errors.push('Le cursus sélectionné est invalide');
  }

  validateContactFields(data, errors);

  return errors;
}
