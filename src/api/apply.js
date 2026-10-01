/**
 * Membership application endpoint
 */

import { error, success } from 'astro-core/router';
import { clampString, isOneOf } from 'astro-core/validation';
import { DEFAULT_ENROLLMENT_TRACKS } from '../lib/settings-defaults.js';
import { readJsonObject, isUniqueConstraintError } from '../lib/request.js';

/**
 * Submit a membership application
 * POST /api/apply
 */
export async function apply(request, env) {
  try {
    const body = await readJsonObject(request);
    if (!body) {
      return error('Requête invalide : un objet JSON est attendu.', 400);
    }
    // Validation
    const enrollmentTracks = await getEnrollmentTracks(env);
    const errors = validateApplication(body, enrollmentTracks);
    if (errors.length > 0) {
      return error(errors.join('; '), 400);
    }

    // Destructure only after validation, which coerces non-string values
    const {
      firstName,
      lastName,
      email,
      studentId,
      enrollmentTrack,
      phone,
      telegram,
      discord
    } = body;

    // Normalise once so the duplicate lookup and the insert agree
    const normalizedEmail = email.toLowerCase().trim();
    const fields = [
      firstName.trim(),
      lastName.trim(),
      normalizedEmail,
      studentId?.trim() || null,
      enrollmentTrack,
      phone?.trim() || null,
      telegram?.trim() || null,
      discord?.trim() || null
    ];

    const existing = await env.DB.prepare(
      'SELECT id, status FROM members WHERE email = ?'
    ).bind(normalizedEmail).first();

    if (existing?.status === 'pending') {
      return error('Une demande avec cet email est déjà en attente de validation.', 409);
    }
    if (existing && existing.status !== 'rejected' && existing.status !== 'expired') {
      return error('Cet email est déjà associé à un membre actif.', 409);
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
      return error('Une demande avec cet email est déjà en attente de validation.', 409);
    }
    console.error('Application error:', error_);
    return error('Une erreur est survenue. Veuillez réessayer.', 500);
  }
}

/**
 * Insert a new pending application and log it in the history.
 * @returns {Promise<number>} the new member id
 */
async function insertApplication(database, fields) {
  const result = await database.prepare(`
    INSERT INTO members (
      first_name, last_name, email, student_id, enrollment_track,
      phone, telegram, discord, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
  `).bind(...fields).run();

  const memberId = result.meta.last_row_id;
  if (memberId) {
    await database.prepare(`
      INSERT INTO membership_history (member_id, new_status, reason)
      VALUES (?, 'pending', 'Application submitted')
    `).bind(memberId).run();
  }
  return memberId;
}

/**
 * Put a previously rejected/expired member back to pending with the
 * freshly submitted details.
 * @returns {Promise<number>} the existing member id
 */
async function reopenApplication(database, existing, fields) {
  const [firstName, lastName, , studentId, enrollmentTrack, phone, telegram, discord] = fields;
  await database.prepare(`
    UPDATE members SET
      first_name = ?, last_name = ?, student_id = ?, enrollment_track = ?,
      phone = ?, telegram = ?, discord = ?, status = 'pending',
      approved_at = NULL, expires_at = NULL,
      created_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(firstName, lastName, studentId, enrollmentTrack, phone, telegram, discord, existing.id).run();

  await database.prepare(`
    INSERT INTO membership_history (member_id, old_status, new_status, reason)
    VALUES (?, ?, 'pending', 'Application re-submitted')
  `).bind(existing.id, existing.status).run();
  return existing.id;
}

/**
 * Load the configured enrollment tracks from settings, falling back to the
 * defaults when the setting is absent, malformed, or the DB is unreachable.
 * @param {object} env
 * @returns {Promise<string[]>}
 */
async function getEnrollmentTracks(env) {
  try {
    const row = await env.DB.prepare(
      "SELECT value FROM settings WHERE key = 'enrollment_tracks'"
    ).first();
    if (row?.value) {
      const parsed = JSON.parse(row.value);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (error_) {
    console.error('Failed to load enrollment tracks setting', error_);
  }
  return DEFAULT_ENROLLMENT_TRACKS;
}

/**
 * Reject a string field that exceeds its maximum length (before clamping).
 * @param {*} value
 * @param {number} max
 * @returns {boolean} true if the value is a string longer than `max`
 */
function isTooLong(value, max) {
  return typeof value === 'string' && clampString(value, max).length < value.trim().length;
}

/**
 * Validate the required name/email fields, pushing errors as they're found.
 * @param {object} data
 * @param {string[]} errors
 */
function validateIdentityFields(data, errors) {
  if (!data.firstName?.trim()) {
    errors.push('Le prénom est requis');
  } else if (isTooLong(data.firstName, 100)) {
    errors.push('Le prénom est trop long (100 caractères maximum)');
  }

  if (!data.lastName?.trim()) {
    errors.push('Le nom est requis');
  } else if (isTooLong(data.lastName, 100)) {
    errors.push('Le nom est trop long (100 caractères maximum)');
  }

  if (!data.email?.trim()) {
    errors.push('L\'email est requis');
  } else if (isTooLong(data.email, 254)) {
    errors.push('L\'email est trop long (254 caractères maximum)');
  } else if (!isValidEmail(data.email)) {
    errors.push('L\'email est invalide');
  }
}

/**
 * Validate the optional contact fields (phone/telegram/discord), including
 * the "at least one contact method" rule.
 * @param {object} data
 * @param {string[]} errors
 */
function validateContactFields(data, errors) {
  if (data.phone && isTooLong(data.phone, 30)) {
    errors.push('Le numéro de téléphone est trop long (30 caractères maximum)');
  }
  if (data.telegram && isTooLong(data.telegram, 64)) {
    errors.push('Le pseudo Telegram est trop long (64 caractères maximum)');
  }
  if (data.discord && isTooLong(data.discord, 64)) {
    errors.push('Le pseudo Discord est trop long (64 caractères maximum)');
  }

  if (!data.phone?.trim() && !data.telegram?.trim() && !data.discord?.trim()) {
    errors.push('Au moins un moyen de contact est requis');
  }
}

/**
 * Validate application data
 * @param {object} data - Raw request body
 * @param {string[]} enrollmentTracks - Currently configured enrollment tracks
 */
function validateApplication(data, enrollmentTracks) {
  const errors = [];

  // Non-string inputs (numbers, arrays, objects) must not reach the
  // trim()/length checks below: coerce them to empty strings up front.
  for (const field of ['firstName', 'lastName', 'email', 'studentId', 'phone', 'telegram', 'discord', 'enrollmentTrack']) {
    if (data[field] !== undefined && data[field] !== null && typeof data[field] !== 'string') {
      data[field] = '';
    }
  }
  if (isTooLong(data.studentId, 32)) {
    errors.push('Le numéro étudiant est trop long (32 caractères maximum)');
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

/**
 * Email validation helper (ReDoS-safe)
 */
function isValidEmail(email) {
  if (!email || typeof email !== 'string' || email.length > 254) return false;
  const atIndex = email.indexOf('@');
  const dotIndex = email.lastIndexOf('.');
  return atIndex > 0 && dotIndex > atIndex + 1 && dotIndex < email.length - 1 && !email.includes(' ');
}
