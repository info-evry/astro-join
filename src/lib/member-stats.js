/**
 * Member counters shared by the public stats, the admin list and the admin stats,
 * so "active" means the same thing everywhere (ACTIVE_STATUSES).
 */

import { ACTIVE_STATUSES } from '../shared/membership.js';
import { sqlList } from './sql.js';

export const ACTIVE_STATUSES_SQL = sqlList(ACTIVE_STATUSES);

/**
 * @param {{ prepare: Function }} db
 * @returns {Promise<{ total: number, active: number, pending: number, rejected: number, expired: number }>}
 */
export async function countMembers(db) {
  const row = await db.prepare(`
    SELECT
      COUNT(*) AS total,
      COUNT(CASE WHEN status IN (${ACTIVE_STATUSES_SQL}) THEN 1 END) AS active,
      COUNT(CASE WHEN status = 'pending' THEN 1 END) AS pending,
      COUNT(CASE WHEN status = 'rejected' THEN 1 END) AS rejected,
      COUNT(CASE WHEN status = 'expired' THEN 1 END) AS expired
    FROM members
  `).first();
  return {
    total: row?.total || 0,
    active: row?.active || 0,
    pending: row?.pending || 0,
    rejected: row?.rejected || 0,
    expired: row?.expired || 0
  };
}
