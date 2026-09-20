/**
 * Formatting helpers for member rows.
 */
import { escapeHtml, formatDate } from '@info-evry/astro-design/scripts/dom';
import { STATUS_LABELS } from './state.js';

const STATUS_BADGE_CLASSES = {
  active: 'success',
  pending: 'warning',
  rejected: 'error',
  expired: 'secondary'
};

const STATUS_TABLE_LABELS = {
  active: 'Actif',
  pending: 'En attente',
  rejected: 'Refusé',
  expired: 'Expiré'
};

export function getContactInfo(member) {
  const contacts = [];
  if (member.phone) contacts.push(`Tel: ${escapeHtml(member.phone)}`);
  if (member.telegram) contacts.push(`TG: ${escapeHtml(member.telegram)}`);
  if (member.discord) contacts.push(`DC: ${escapeHtml(member.discord)}`);
  return contacts.length > 0 ? contacts.join('<br>') : '-';
}

export function getStatusClass(status) {
  return STATUS_BADGE_CLASSES[status] || 'secondary';
}

export function getStatusLabel(status) {
  return STATUS_TABLE_LABELS[status] || status;
}

/** Format a member date, matching the previous "dd/mm/yyyy[ hh:mm]" look. */
export function formatMemberDate(dateStr, includeTime = false) {
  if (!dateStr) return '-';
  return formatDate(dateStr, includeTime ? { dateStyle: 'short', timeStyle: 'short' } : { dateStyle: 'short' });
}

export function fullStatusLabel(status) {
  return STATUS_LABELS[status] || status;
}
