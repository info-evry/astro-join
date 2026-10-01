/**
 * Admin authentication for this site.
 *
 * join has no CONFIG KV namespace: the admin token is the `ADMIN_TOKEN`
 * secret only, so KV lookup is explicitly disabled (`kv: null`) and a
 * stray `CONFIG` binding can never override the secret.
 */

import { adminOnly } from 'astro-core/auth';

/** Options for `verifyAdminToken` / `adminOnly` / `createAdminGuard`. */
export const ADMIN_AUTH_OPTIONS = Object.freeze({ kv: null });

/**
 * Wrap a router handler so it only runs for an authenticated admin (401 otherwise).
 * @template {(request: Request, env: any, ctx: any, params: any) => any} H
 * @param {H} handler
 */
export function adminHandler(handler) {
  return adminOnly(handler, ADMIN_AUTH_OPTIONS);
}
