/**
 * Pending applications tab: list + bulk "approve all".
 */
import { $, escapeHtml } from '@info-evry/astro-design/scripts/dom';
import { setTabBadge } from '@info-evry/astro-design/scripts/tabs';
import { toastSuccess, toastError } from '@info-evry/astro-design/scripts/toast';
import { closeModal, openModal } from '@info-evry/astro-design/scripts/modal';
import { state } from '../state.js';
import { getContactInfo, formatMemberDate } from '../format.js';

const CONFIRM_MODAL = 'confirm-modal';

export function renderPendingApplications(members) {
  const container = $('pending-container');
  const approveAllBtn = $('approve-all-btn');
  const pending = members.filter((m) => m.status === 'pending');

  setTabBadge('pending', pending.length, { hideWhenZero: false });
  approveAllBtn.disabled = pending.length === 0;

  if (pending.length === 0) {
    container.innerHTML = '<p class="text-muted">Aucune demande en attente</p>';
    return;
  }

  container.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>Nom</th>
          <th>Email</th>
          <th class="team-col">Cursus</th>
          <th>Contact</th>
          <th>Date</th>
          <th class="actions-col">Actions</th>
        </tr>
      </thead>
      <tbody>
        ${pending.map((m) => `
          <tr data-id="${m.id}">
            <td>${escapeHtml(m.first_name)} ${escapeHtml(m.last_name)}</td>
            <td><a href="mailto:${escapeHtml(m.email)}">${escapeHtml(m.email)}</a></td>
            <td>${escapeHtml(m.enrollment_track)}</td>
            <td class="contact-cell">${getContactInfo(m)}</td>
            <td>${formatMemberDate(m.created_at, true)}</td>
            <td class="actions-col">
              <div class="action-buttons">
                <button class="action-btn primary" data-action="approve-member" data-member-id="${m.id}">Approuver</button>
                <button class="action-btn danger" data-action="reject-member" data-member-id="${m.id}">Refuser</button>
              </div>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

export function loadPending() {
  renderPendingApplications(state.members);
}

export async function approveMember(id, api, loadData) {
  try {
    await api(`/admin/members/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ status: 'active', reason: 'Approved by admin' })
    });
    toastSuccess('Membre approuvé');
    loadData();
  } catch (error) {
    toastError(error.message);
  }
}

export function rejectMember(id, api, loadData) {
  $('confirm-message').textContent = 'Êtes-vous sûr de vouloir refuser cette demande ?';
  const confirmBtn = $('confirm-btn');
  confirmBtn.className = 'btn btn-danger';
  confirmBtn.textContent = 'Confirmer';
  confirmBtn.onclick = async () => {
    try {
      await api(`/admin/members/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'rejected', reason: 'Rejected by admin' })
      });
      toastSuccess('Demande refusée');
      closeModal(CONFIRM_MODAL);
      loadData();
    } catch (error) {
      toastError(error.message);
    }
  };
  openModal(CONFIRM_MODAL);
}

export async function approveAll(api, loadData) {
  const pending = state.members.filter((m) => m.status === 'pending');
  if (pending.length === 0) return;

  $('confirm-message').textContent = `Approuver ${pending.length} demande(s) ?`;
  const confirmBtn = $('confirm-btn');
  confirmBtn.className = 'btn btn-primary';
  confirmBtn.textContent = 'Approuver';
  confirmBtn.onclick = async () => {
    try {
      await api('/admin/members/batch', {
        method: 'POST',
        body: JSON.stringify({
          memberIds: pending.map((m) => m.id),
          status: 'active',
          reason: 'Batch approved by admin'
        })
      });
      toastSuccess(`${pending.length} membre(s) approuvé(s)`);
      closeModal(CONFIRM_MODAL);
      loadData();
    } catch (error) {
      toastError(error.message);
    }
  };
  openModal(CONFIRM_MODAL);
}
