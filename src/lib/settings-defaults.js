/**
 * Default values for admin-configurable settings.
 * Kept separate from the API handlers so both the public config endpoint
 * and the application validation logic can share the same defaults.
 */

/**
 * Default list of enrollment tracks shown on the membership form, used
 * whenever the `enrollment_tracks` setting has not been overridden.
 */
export const DEFAULT_ENROLLMENT_TRACKS = [
  'L1 Informatique',
  'L2 Informatique',
  'L3 Informatique',
  'M1 Informatique',
  'M2 Informatique',
  'Autre'
];
