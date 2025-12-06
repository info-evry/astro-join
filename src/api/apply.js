/**
 * Membership application endpoint
 */

import { error, success } from '../shared/response.js';

/**
 * Submit a membership application
 * POST /api/apply
 */
export async function apply(request, env) {
  try {
    const body = await request.json();
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

    // Validation
    const errors = validateApplication(body);
    if (errors.length > 0) {
      return error(errors.join('; '), 400);
    }

    // Check if email already exists
    const existing = await env.DB.prepare(
      'SELECT id, status FROM members WHERE email = ?'
    ).bind(email.toLowerCase()).first();

    if (existing) {
      if (existing.status === 'pending') {
        return error('Une demande avec cet email est déjà en attente de validation.', 409);
      } else if (existing.status === 'active') {
        return error('Cet email est déjà associé à un membre actif.', 409);
      }
      // If rejected or expired, allow re-application
    }

    // Insert new member application
    const result = await env.DB.prepare(`
      INSERT INTO members (
        first_name, last_name, email, student_id, enrollment_track,
        phone, telegram, discord, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `).bind(
      firstName.trim(),
      lastName.trim(),
      email.toLowerCase().trim(),
      studentId?.trim() || null,
      enrollmentTrack,
      phone?.trim() || null,
      telegram?.trim() || null,
      discord?.trim() || null
    ).run();

    // Log the application
    if (result.meta.last_row_id) {
      await env.DB.prepare(`
        INSERT INTO membership_history (member_id, new_status, reason)
        VALUES (?, 'pending', 'Application submitted')
      `).bind(result.meta.last_row_id).run();
    }

    return success(
      'Votre demande d\'adhésion a bien été enregistrée. Vous recevrez un email de confirmation une fois votre demande validée.',
      { memberId: result.meta.last_row_id }
    );

  } catch (error_) {
    console.error('Application error:', error_);
    return error('Une erreur est survenue. Veuillez réessayer.', 500);
  }
}

/**
 * Validate application data
 */
function validateApplication(data) {
  const errors = [];

  if (!data.firstName?.trim()) {
    errors.push('Le prénom est requis');
  }
  if (!data.lastName?.trim()) {
    errors.push('Le nom est requis');
  }
  if (!data.email?.trim()) {
    errors.push('L\'email est requis');
  } else if (!isValidEmail(data.email)) {
    errors.push('L\'email est invalide');
  }
  if (!data.enrollmentTrack) {
    errors.push('Le cursus est requis');
  }

  // At least one contact method
  if (!data.phone?.trim() && !data.telegram?.trim() && !data.discord?.trim()) {
    errors.push('Au moins un moyen de contact est requis');
  }

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
