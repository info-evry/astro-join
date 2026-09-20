/**
 * Shared mutable state for the membership admin dashboard.
 * Kept in one module so feature modules can read/update it without
 * reaching into each other.
 */

export const STATUS_LABELS = {
  pending: 'En attente',
  active: 'Membre actif',
  honor: "Membre d'honneur",
  secretary: 'Secrétaire',
  treasurer: 'Trésorier',
  president: 'Président',
  honorary_president: "Président d'honneur",
  vice_president: 'Vice-président',
  rejected: 'Refusé',
  expired: 'Expiré'
};

export const BUREAU_STATUSES = new Set([
  'secretary',
  'treasurer',
  'president',
  'honorary_president',
  'vice_president'
]);

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
