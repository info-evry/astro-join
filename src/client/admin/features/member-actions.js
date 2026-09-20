/**
 * Members tab: single-member CRUD (edit/delete/approve) and bulk actions
 * against the currently selected members, plus CSV export.
 */
import { $ } from '@info-evry/astro-design/scripts/dom';
import { toastSuccess, toastError } from '@info-evry/astro-design/scripts/toast';
import { closeModal, openModal } from '@info-evry/astro-design/scripts/modal';
import { state, STATUS_LABELS } from '../state.js';

const CONFIRM_MODAL = 'confirm-modal';
const CONFIRM_MESSAGE = 'confirm-message';
const CONFIRM_BTN = 'confirm-btn';

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
  $(CONFIRM_MESSAGE).textContent = `Êtes-vous sûr de vouloir supprimer ${member?.first_name} ${member?.last_name} ?`;
  const confirmBtn = $(CONFIRM_BTN);
  confirmBtn.className = 'btn btn-danger';
  confirmBtn.textContent = 'Confirmer';
  confirmBtn.onclick = async () => {
    try {
      await api(`/admin/members/${id}`, { method: 'DELETE' });
      toastSuccess('Membre supprimé');
      closeModal(CONFIRM_MODAL);
      loadData();
    } catch (error) {
      toastError(error.message);
    }
  };
  openModal(CONFIRM_MODAL);
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

async function runBulk(api, loadData, ids, payload, successMessage) {
  try {
    await api('/admin/members/batch', { method: 'POST', body: JSON.stringify({ memberIds: ids, ...payload }) });
    toastSuccess(successMessage);
    state.selectedMembers.clear();
    closeModal(CONFIRM_MODAL);
    loadData();
  } catch (error) {
    toastError(error.message);
  }
}

export function bulkApprove(api, loadData) {
  if (state.selectedMembers.size === 0) return;
  const ids = [...state.selectedMembers];
  $(CONFIRM_MESSAGE).textContent = `Approuver ${ids.length} membre(s) sélectionné(s) ?`;
  const confirmBtn = $(CONFIRM_BTN);
  confirmBtn.className = 'btn btn-primary';
  confirmBtn.textContent = 'Approuver';
  confirmBtn.onclick = () => runBulk(api, loadData, ids, { status: 'active', reason: 'Bulk approved by admin' }, `${ids.length} membre(s) approuvé(s)`);
  openModal(CONFIRM_MODAL);
}

export function bulkSetStatus(newStatus, api, loadData) {
  if (state.selectedMembers.size === 0) return;
  const ids = [...state.selectedMembers];
  const statusLabel = STATUS_LABELS[newStatus] || newStatus;
  $(CONFIRM_MESSAGE).textContent = `Définir ${ids.length} membre(s) comme "${statusLabel}" ?`;
  const confirmBtn = $(CONFIRM_BTN);
  confirmBtn.className = 'btn btn-primary';
  confirmBtn.textContent = 'Confirmer';
  confirmBtn.onclick = () => runBulk(api, loadData, ids, { status: newStatus, reason: `Bulk status change to ${newStatus} by admin` }, `${ids.length} membre(s) mis à jour`);
  openModal(CONFIRM_MODAL);
}

export function bulkDelete(api, loadData) {
  if (state.selectedMembers.size === 0) return;
  const ids = [...state.selectedMembers];
  $(CONFIRM_MESSAGE).innerHTML = `<strong style="color: var(--color-error);">Supprimer définitivement ${ids.length} membre(s) ?</strong><br><small>Cette action est irréversible.</small>`;
  const confirmBtn = $(CONFIRM_BTN);
  confirmBtn.className = 'btn btn-danger';
  confirmBtn.textContent = 'Supprimer';
  confirmBtn.onclick = async () => {
    let deleted = 0;
    for (const id of ids) {
      try {
        await api(`/admin/members/${id}`, { method: 'DELETE' });
        deleted++;
      } catch (error) {
        console.error(`Failed to delete member ${id}:`, error);
      }
    }
    toastSuccess(`${deleted} membre(s) supprimé(s)`);
    state.selectedMembers.clear();
    closeModal(CONFIRM_MODAL);
    loadData();
  };
  openModal(CONFIRM_MODAL);
}

export async function handleExport(api) {
  try {
    const status = $('filter-status').value;
    const url = status ? `/admin/export?status=${status}` : '/admin/export';
    const response = await api(url);
    const blob = await response.blob();
    const downloadUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = status ? `members_${status}.csv` : 'members.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(downloadUrl);
  } catch (error) {
    toastError(error.message);
  }
}
