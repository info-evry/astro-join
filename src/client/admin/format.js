/**
 * Formatting helpers for member rows. Status labels come from the shared
 * membership model (`statusLabel`); only the badge colours are defined here.
 */
import { escapeHtml, formatDate } from '@info-evry/astro-design/scripts/dom';

const STATUS_BADGE_CLASSES = {
  active: 'success',
  pending: 'warning',
  rejected: 'error',
  expired: 'secondary'
};

export function getContactInfo(member) {
  const contacts = [];
  if (member.phone) contacts.push(`Tel: ${escapeHtml(member.phone)}`);
  if (member.telegram) contacts.push(`TG: ${escapeHtml(member.telegram)}`);
  if (member.discord) contacts.push(`DC: ${escapeHtml(member.discord)}`);
  return contacts.length > 0 ? contacts.join('<br>') : '-';
}

export function getStatusClass(status) {
  return Object.hasOwn(STATUS_BADGE_CLASSES, status) ? STATUS_BADGE_CLASSES[status] : 'secondary';
}

/** Format a member date, matching the previous "dd/mm/yyyy[ hh:mm]" look. */
export function formatMemberDate(dateStr, includeTime = false) {
  if (!dateStr) return '-';
  return formatDate(dateStr, includeTime ? { dateStyle: 'short', timeStyle: 'short' } : { dateStyle: 'short' });
}
