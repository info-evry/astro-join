/**
 * Members tab: single-member CRUD (edit/delete/approve) and bulk actions
 * against the currently selected members, plus CSV export.
 *
 * Confirmations go through astro-design's `confirmAction` (plain-text
 * messages, one click handler at a time, errors toasted, modal closed on
 * success) and the export through `downloadFromApi`.
 */
import { $ } from '@info-evry/astro-design/scripts/dom';
import { toastSuccess, toastError } from '@info-evry/astro-design/scripts/toast';
import { closeModal, openModal } from '@info-evry/astro-design/scripts/modal';
import { confirmAction } from '@info-evry/astro-design/scripts/confirm';
import { downloadFromApi } from '@info-evry/astro-design/scripts/download';
import { chunk } from 'astro-core/d1';
import { MAX_BATCH_IDS, statusLabel } from '../../../shared/membership.js';
import { state } from '../state.js';

export function editMember(id) {
  const member = state.members.find((m) => m.id === id);
  if (!member) return;

  $('member-form-id').value = id;
  $('member-form-firstname').value = member.first_name;
  $('member-form-lastname').value = member.last_name;
  $('member-form-email').value = member.email;
  $('member-form-studentid').value = member.student_id || '';
  $('member-form-track').value = member.enrollment_track;
  $('member-form-status').value = member.status;
  $('member-form-notes').value = member.notes || '';
  openModal('member-modal');
}

export function confirmDeleteMember(id, api, loadData) {
  const member = state.members.find((m) => m.id === id);
  const name = member ? `${member.first_name} ${member.last_name}` : 'ce membre';
  confirmAction({
    message: `Êtes-vous sûr de vouloir supprimer ${name} ?`,
    confirmLabel: 'Confirmer',
    onConfirm: async () => {
      await api(`/admin/members/${id}`, { method: 'DELETE' });
      toastSuccess('Membre supprimé');
      loadData();
    }
  });
}

export async function handleMemberSubmit(e, api, loadData) {
  e.preventDefault();
  const id = $('member-form-id').value;

  try {
    await api(`/admin/members/${id}`, {
      method: 'PUT',
      body: JSON.stringify({
        firstName: $('member-form-firstname').value,
        lastName: $('member-form-lastname').value,
        email: $('member-form-email').value,
        studentId: $('member-form-studentid').value,
        enrollmentTrack: $('member-form-track').value,
        status: $('member-form-status').value,
        notes: $('member-form-notes').value
      })
    });
    toastSuccess('Membre mis à jour');
    closeModal('member-modal');
    loadData();
  } catch (error) {
    toastError(error.message);
  }
}

/** Selection to act on, or null (and nothing to do) when empty. */
function selectedIds() {
  return state.selectedMembers.size === 0 ? null : [...state.selectedMembers];
}

/** Confirm, then run a status change on the selection (one request per MAX_BATCH_IDS ids). */
function confirmBulkStatus({ message, confirmLabel, variant, status, reason, successMessage, api, loadData, ids }) {
  confirmAction({
    message,
    confirmLabel,
    variant,
    onConfirm: async () => {
      for (const group of chunk(ids, MAX_BATCH_IDS)) {
        await api('/admin/members/batch', { method: 'POST', body: JSON.stringify({ memberIds: group, status, reason }) });
      }
      toastSuccess(successMessage);
      state.selectedMembers.clear();
      loadData();
    }
  });
}

export function bulkApprove(api, loadData) {
  const ids = selectedIds();
  if (!ids) return;
  confirmBulkStatus({
    message: `Approuver ${ids.length} membre(s) sélectionné(s) ?`,
    confirmLabel: 'Approuver',
    variant: 'primary',
    status: 'active',
    reason: 'Bulk approved by admin',
    successMessage: `${ids.length} membre(s) approuvé(s)`,
    api,
    loadData,
    ids
  });
}

export function bulkSetStatus(newStatus, api, loadData) {
  const ids = selectedIds();
  if (!ids) return;
  confirmBulkStatus({
    message: `Définir ${ids.length} membre(s) comme "${statusLabel(newStatus)}" ?`,
    confirmLabel: 'Confirmer',
    variant: 'primary',
    status: newStatus,
    reason: `Bulk status change to ${newStatus} by admin`,
    successMessage: `${ids.length} membre(s) mis à jour`,
    api,
    loadData,
    ids
  });
}

/** Delete the selection with DELETE /admin/members/batch (one request per MAX_BATCH_IDS ids). */
export function bulkDelete(api, loadData) {
  const ids = selectedIds();
  if (!ids) return;
  confirmAction({
    message: `Supprimer définitivement ${ids.length} membre(s) ? Cette action est irréversible.`,
    confirmLabel: 'Supprimer',
    onConfirm: async () => {
      let deleted = 0;
      for (const group of chunk(ids, MAX_BATCH_IDS)) {
        const result = await api('/admin/members/batch', { method: 'DELETE', body: JSON.stringify({ ids: group }) });
        deleted += result?.deleted ?? group.length;
      }
      toastSuccess(`${deleted} membre(s) supprimé(s)`);
      state.selectedMembers.clear();
      loadData();
    }
  });
}

export async function handleExport(api) {
  try {
    const status = $('filter-status').value;
    const endpoint = status ? `/admin/export?status=${encodeURIComponent(status)}` : '/admin/export';
    await downloadFromApi(api, endpoint, status ? `members_${status}.csv` : 'members.csv');
  } catch (error) {
    toastError(error.message);
  }
}
