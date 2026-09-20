/**
 * Members tab: filtering, sorting, selection and rendering of the members
 * table. Single-member/bulk CRUD actions live in `member-actions.js`.
 */
import { $, escapeHtml, debounce } from '@info-evry/astro-design/scripts/dom';
import { setTabBadge } from '@info-evry/astro-design/scripts/tabs';
import { state, BUREAU_STATUSES } from '../state.js';
import { getContactInfo, getStatusClass, getStatusLabel, formatMemberDate } from '../format.js';
import { handleMemberSubmit, handleExport } from './member-actions.js';

function getFiltered(members) {
  const statusFilter = $('filter-status').value;
  const trackFilter = $('filter-track').value;
  const searchQuery = ($('filter-search').value || '').toLowerCase().trim();

  let filtered = members;
  if (statusFilter) {
    filtered = statusFilter === 'bureau'
      ? filtered.filter((m) => BUREAU_STATUSES.has(m.status))
      : filtered.filter((m) => m.status === statusFilter);
  }
  if (trackFilter) filtered = filtered.filter((m) => m.enrollment_track === trackFilter);
  if (searchQuery) {
    filtered = filtered.filter((m) => {
      const fields = [
        m.first_name, m.last_name, m.email, m.student_id,
        m.phone, m.telegram, m.discord, m.enrollment_track, m.notes
      ].filter(Boolean).join(' ').toLowerCase();
      return fields.includes(searchQuery);
    });
  }
  return filtered;
}

function sortMembers(members) {
  return [...members].sort((a, b) => {
    let valA = a[state.sortField];
    let valB = b[state.sortField];
    if (valA == null) valA = '';
    if (valB == null) valB = '';
    if (typeof valA === 'string') valA = valA.toLowerCase();
    if (typeof valB === 'string') valB = valB.toLowerCase();

    let comparison = 0;
    if (valA < valB) comparison = -1;
    else if (valA > valB) comparison = 1;
    return state.sortDirection === 'asc' ? comparison : -comparison;
  });
}

export function toggleSort(field) {
  if (state.sortField === field) {
    state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
  } else {
    state.sortField = field;
    state.sortDirection = 'asc';
  }
  renderMembers(state.members);
}

const SORTABLE_COLUMNS = [
  { field: 'last_name', label: 'Nom' },
  { field: 'email', label: 'Email' },
  { field: 'student_id', label: 'N° Étudiant' },
  { field: 'enrollment_track', label: 'Cursus', class: 'team-col' },
  { field: 'status', label: 'Statut', class: 'badge-col' },
  { field: 'created_at', label: 'Inscription' }
];

function sortHeader({ field, label, class: colClass }) {
  const sortAttr = state.sortField === field ? ` data-sort="${state.sortDirection}"` : '';
  const classAttr = colClass ? `${colClass} sortable` : 'sortable';
  return `<th class="${classAttr}" data-action="sort-members" data-field="${field}"${sortAttr}>${label}<span class="sort-indicator"></span></th>`;
}

export function renderMembers(members) {
  const filtered0 = getFiltered(members);
  setTabBadge('members', filtered0.length, { hideWhenZero: false });

  const visibleIds = new Set(filtered0.map((m) => m.id));
  state.selectedMembers = new Set([...state.selectedMembers].filter((id) => visibleIds.has(id)));
  updateSelectionUI();

  const container = $('members-container');
  if (filtered0.length === 0) {
    container.innerHTML = '<p class="text-muted">Aucun membre trouvé</p>';
    return;
  }

  const filtered = sortMembers(filtered0);
  const allSelected = filtered.every((m) => state.selectedMembers.has(m.id));

  container.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th class="checkbox-col">
            <input type="checkbox" id="select-all" ${allSelected ? 'checked' : ''} data-change="toggle-select-all">
          </th>
          ${sortHeader(SORTABLE_COLUMNS[0])}
          ${sortHeader(SORTABLE_COLUMNS[1])}
          ${sortHeader(SORTABLE_COLUMNS[2])}
          ${sortHeader(SORTABLE_COLUMNS[3])}
          <th>Contact</th>
          ${sortHeader(SORTABLE_COLUMNS[4])}
          ${sortHeader(SORTABLE_COLUMNS[5])}
          <th class="actions-col">Actions</th>
        </tr>
      </thead>
      <tbody>
        ${filtered.map((m) => memberRow(m)).join('')}
      </tbody>
    </table>
  `;
}

function memberRow(m) {
  let notesHtml = '';
  if (m.notes) {
    const ellipsis = m.notes.length > 50 ? '...' : '';
    notesHtml = `<br><small class="text-muted">${escapeHtml(m.notes.slice(0, 50) + ellipsis)}</small>`;
  }

  return `
    <tr data-id="${m.id}" class="${state.selectedMembers.has(m.id) ? 'selected' : ''}">
      <td class="checkbox-col">
        <input type="checkbox" ${state.selectedMembers.has(m.id) ? 'checked' : ''} data-change="toggle-member-select" data-member-id="${m.id}">
      </td>
      <td>
        <strong>${escapeHtml(m.first_name)} ${escapeHtml(m.last_name)}</strong>
        ${notesHtml}
      </td>
      <td><a href="mailto:${escapeHtml(m.email)}">${escapeHtml(m.email)}</a></td>
      <td>${m.student_id ? escapeHtml(m.student_id) : '<span class="text-muted">-</span>'}</td>
      <td class="team-col">${escapeHtml(m.enrollment_track)}</td>
      <td class="contact-cell">${getContactInfo(m)}</td>
      <td class="badge-col"><span class="badge badge-${getStatusClass(m.status)}">${getStatusLabel(m.status)}</span></td>
      <td>${formatMemberDate(m.created_at, true)}</td>
      <td class="actions-col">
        <div class="action-buttons">
          <button class="icon-btn" data-action="edit-member" data-member-id="${m.id}" title="Modifier" aria-label="Modifier le membre">􀈊</button>
          ${m.status === 'pending' ? `<button class="icon-btn success" data-action="approve-member" data-member-id="${m.id}" title="Approuver" aria-label="Approuver le membre">􀁢</button>` : ''}
          <button class="icon-btn danger" data-action="confirm-delete-member" data-member-id="${m.id}" title="Supprimer" aria-label="Supprimer le membre">􀈑</button>
        </div>
      </td>
    </tr>
  `;
}

function updateSelectionUI() {
  const count = state.selectedMembers.size;
  $('selection-count').textContent = `${count} sélectionné(s)`;
  $('bulk-actions').classList.toggle('hidden', count === 0);
}

export function toggleSelectAll(checked) {
  const filtered = getFiltered(state.members);
  if (checked) {
    for (const m of filtered) state.selectedMembers.add(m.id);
  } else {
    state.selectedMembers.clear();
  }
  renderMembers(state.members);
}

export function toggleMemberSelection(id, checked) {
  if (checked) {
    state.selectedMembers.add(id);
  } else {
    state.selectedMembers.delete(id);
  }
  updateSelectionUI();

  const row = document.querySelector(`tr[data-id="${id}"]`);
  row?.classList.toggle('selected', checked);

  const selectAll = $('select-all');
  if (selectAll) {
    const visibleRows = document.querySelectorAll('#members-container tbody tr');
    const allChecked = [...visibleRows].every((r) => state.selectedMembers.has(Number.parseInt(r.dataset.id)));
    selectAll.checked = allChecked && visibleRows.length > 0;
  }
}

export function populateTrackFilter(members) {
  const filterTrack = $('filter-track');
  const tracks = [...new Set(members.map((m) => m.enrollment_track))].sort();
  filterTrack.innerHTML = '<option value="">Tous les cursus</option>' +
    tracks.map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
}

export function initMembers(api, loadData) {
  $('filter-search').addEventListener('input', debounce(() => renderMembers(state.members), 300));
  $('filter-status').addEventListener('change', () => renderMembers(state.members));
  $('filter-track').addEventListener('change', () => renderMembers(state.members));
  $('member-form').addEventListener('submit', (e) => handleMemberSubmit(e, api, loadData));
  $('export-btn').addEventListener('click', () => handleExport(api));
}
