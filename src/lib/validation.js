/**
 * Validation module - re-exports from shared core library
 *
 * This file exists for backwards compatibility.
 * The canonical validation implementation is in astro-core.
 */
export {
  isValidEmail,
  sanitizeString,
  parseInteger,
  isDeadlinePassed,
  isAfterCutoff
} from '../../core/src/lib/validation.js';
