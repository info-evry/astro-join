/**
 * Router module - re-exports from shared core library
 *
 * This file exists for backwards compatibility.
 * The canonical router implementation is in astro-core.
 */
export {
  Router,
  json,
  error,
  success,
  corsHeaders,
  handleCors
} from '../../core/src/lib/router.js';
