/**
 * Shared mutable state for the membership admin dashboard.
 * Kept in one module so feature modules can read/update it without
 * reaching into each other. (Status labels and bureau roles come from
 * src/shared/membership.js, the same model the API uses.)
 */

export const state = {
  members: [],
  stats: null,
  selectedMembers: new Set(),
  sortField: 'created_at',
  sortDirection: 'desc',
  importData: null
};

export function setMembersData(members, stats) {
  state.members = members;
  state.stats = stats;
}
