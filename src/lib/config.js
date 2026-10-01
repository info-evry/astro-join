/**
 * Effective membership configuration, read from the `settings` table.
 *
 * Values are stored as text: booleans as 'true'/'false', arrays as JSON and
 * the academic year as a bare `YYYY-YYYY` string, so reading them back means
 * "JSON when it parses, the raw text otherwise". Missing or malformed values
 * fall back to the defaults of src/shared/membership.js.
 */

import { DEFAULT_ACADEMIC_YEAR, DEFAULT_ENROLLMENT_TRACKS } from '../shared/membership.js';

/**
 * Parse a stored setting value: JSON when valid, else the raw text.
 * @param {string} raw
 * @returns {unknown}
 */
export function parseSettingValue(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/**
 * Typed settings object (booleans and arrays parsed) from `settings` rows.
 * @param {Array<{ key: string, value: string }>} rows
 * @returns {Record<string, unknown>}
 */
export function parseSettingRows(rows) {
  return Object.fromEntries(rows.map((row) => [row.key, parseSettingValue(row.value)]));
}

/** @param {unknown} value */
function isTrackList(value) {
  return Array.isArray(value) && value.length > 0 && value.every((track) => typeof track === 'string' && track.trim() !== '');
}

/**
 * The configuration the public site and the application rules use.
 * @param {{ prepare: Function }} db
 * @returns {Promise<{ membershipOpen: boolean, currentYear: string, enrollmentTracks: string[] }>}
 * @throws when the database cannot be read
 */
export async function loadMembershipConfig(db) {
  const { results } = await db.prepare('SELECT key, value FROM settings').all();
  const settings = parseSettingRows(results ?? []);
  return {
    membershipOpen: settings.membership_open !== false && settings.membership_open !== 'false',
    currentYear:
      typeof settings.current_year === 'string' && settings.current_year ? settings.current_year : DEFAULT_ACADEMIC_YEAR,
    enrollmentTracks: isTrackList(settings.enrollment_tracks) ? settings.enrollment_tracks : [...DEFAULT_ENROLLMENT_TRACKS]
  };
}
