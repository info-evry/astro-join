/**
 * Membership Admin Dashboard
 * Client-side admin interface for managing membership applications
 */

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

function $(id) {
  return document.getElementById(id);
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function debounce(fn, delay) {
  let timeoutId;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

// ============================================================
// STATE MANAGEMENT
// ============================================================

let membersData = [];
let statsData = null;
let selectedMembers = new Set();
let sortField = 'created_at';
let sortDirection = 'desc';
let importData = null;
let adminToken = localStorage.getItem('join_admin_token') || '';

// Status labels for display
const STATUS_LABELS = {
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

const BUREAU_STATUSES = new Set(['secretary', 'treasurer', 'president', 'honorary_president', 'vice_president']);

// Element ID constants
const EL_CONFIRM_MESSAGE = 'confirm-message';
const EL_CONFIRM_MODAL = 'confirm-modal';

// ============================================================
// API FUNCTIONS
// ============================================================

/**
 * Get the API base URL from the meta tag
 */
function getApiBase() {
  const baseUrl = document.querySelector('meta[name="base-url"]')?.content || '';
  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
}

async function api(endpoint, options = {}) {
  const API_BASE = getApiBase();
  const response = await fetch(`${API_BASE}/api${endpoint}`, {
    headers: {
      'Authorization': `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
      ...options.headers
    },
    ...options
  });

  if (response.status === 401) {
    throw new Error('Unauthorized');
  }

  if (response.headers.get('Content-Type')?.includes('text/csv')) {
    return response;
  }

  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || 'Request failed');
  }

  return response.json();
}

// ============================================================
// TOAST NOTIFICATIONS
// ============================================================

function showToast(message, type = 'success', duration = 3000) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

function toastSuccess(message) { showToast(message, 'success'); }
function toastError(message) { showToast(message, 'error'); }

// ============================================================
// MODAL & DISCLOSURE
// ============================================================

export function closeModal(modalId) {
  $(modalId).classList.add('hidden');
}

function openModal(modalId) {
  $(modalId).classList.remove('hidden');
}

export function toggleDisclosure(name) {
  const group = document.querySelector(`[data-disclosure="${name}"]`);
  if (group) group.classList.toggle('open');
}

/**
 * Switch to a specific tab
 * @param {string} tabName - Tab name to switch to
 */
export function switchTab(tabName) {
  // Update sidebar buttons
  for (const btn of document.querySelectorAll('.admin-sidebar-item')) {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  }

  // Update tab panels
  for (const panel of document.querySelectorAll('.tab-panel')) {
    panel.classList.toggle('hidden', panel.id !== `panel-${tabName}`);
  }
}

/**
 * Initialize sidebar navigation
 */
function initSidebar() {
  for (const btn of document.querySelectorAll('.admin-sidebar-item[data-tab]')) {
    btn.addEventListener('click', () => {
      switchTab(btn.dataset.tab);
    });
  }
}

// ============================================================
// SORTING
// ============================================================

/**
 * Get sort indicator icon for column header
 * @param {string} field - Field to check
 * @returns {string} Sort indicator or empty string
 */
function getSortIcon(field) {
  if (sortField !== field) return '';
  return sortDirection === 'asc' ? ' ▲' : ' ▼';
}

function sortMembers(members) {
  return [...members].sort((a, b) => {
    let valA = a[sortField];
    let valB = b[sortField];

    // Handle null/undefined
    if (valA == null) valA = '';
    if (valB == null) valB = '';

    // String comparison
    if (typeof valA === 'string') valA = valA.toLowerCase();
    if (typeof valB === 'string') valB = valB.toLowerCase();

    let comparison = 0;
    if (valA < valB) comparison = -1;
    else if (valA > valB) comparison = 1;

    return sortDirection === 'asc' ? comparison : -comparison;
  });
}

export function toggleSort(field) {
  if (sortField === field) {
    sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
  } else {
    sortField = field;
    sortDirection = 'asc';
  }
  renderMembers(membersData);
}

// ============================================================
// RENDER FUNCTIONS
// ============================================================

function renderStats(stats) {
  const elements = getElements();
  elements.statsGrid.innerHTML = `
    <div class="stat-card">
      <div class="stat-value">${stats.active}</div>
      <div class="stat-label">Membres actifs</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${stats.pending}</div>
      <div class="stat-label">En attente</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${stats.total}</div>
      <div class="stat-label">Total</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${stats.expired}</div>
      <div class="stat-label">Expirés</div>
    </div>
  `;
}

function renderBureau(members) {
  const elements = getElements();
  const bureau = members.filter(m => BUREAU_STATUSES.has(m.status));

  if (bureau.length === 0) {
    elements.bureauContainer.innerHTML = '<p class="text-muted">Aucun membre du bureau défini</p>';
    return;
  }

  // Sort by role importance
  const roleOrder = ['president', 'vice_president', 'secretary', 'treasurer', 'honorary_president'];
  bureau.sort((a, b) => roleOrder.indexOf(a.status) - roleOrder.indexOf(b.status));

  elements.bureauContainer.innerHTML = `
    <div class="bureau-grid">
      ${bureau.map(m => `
        <div class="bureau-card">
          <div class="bureau-role">${STATUS_LABELS[m.status] || m.status}</div>
          <div class="bureau-name">${escapeHtml(m.first_name)} ${escapeHtml(m.last_name)}</div>
          <div class="bureau-email"><a href="mailto:${escapeHtml(m.email)}">${escapeHtml(m.email)}</a></div>
          <div class="bureau-actions">
            <button class="icon-btn" onclick="window.adminDashboard.editMember(${m.id})" title="Modifier" aria-label="Modifier le membre">􀈊</button>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderPendingApplications(members) {
  const elements = getElements();
  const pending = members.filter(m => m.status === 'pending');
  elements.pendingBadge.textContent = pending.length;
  elements.approveAllBtn.disabled = pending.length === 0;

  if (pending.length === 0) {
    elements.pendingContainer.innerHTML = '<p class="text-muted">Aucune demande en attente</p>';
    return;
  }

  elements.pendingContainer.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>Nom</th>
          <th>Email</th>
          <th>Cursus</th>
          <th>Contact</th>
          <th>Date</th>
          <th class="actions-col">Actions</th>
        </tr>
      </thead>
      <tbody>
        ${pending.map(m => `
          <tr data-id="${m.id}">
            <td>${escapeHtml(m.first_name)} ${escapeHtml(m.last_name)}</td>
            <td><a href="mailto:${escapeHtml(m.email)}">${escapeHtml(m.email)}</a></td>
            <td>${escapeHtml(m.enrollment_track)}</td>
            <td>${getContactInfo(m)}</td>
            <td>${formatDate(m.created_at, true)}</td>
            <td class="actions-col">
              <div class="action-buttons">
                <button class="action-btn primary" onclick="window.adminDashboard.approveMember(${m.id})">Approuver</button>
                <button class="action-btn danger" onclick="window.adminDashboard.rejectMember(${m.id})">Refuser</button>
              </div>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function renderMembers(members) {
  const elements = getElements();
  const statusFilter = elements.filterStatus.value;
  const trackFilter = elements.filterTrack.value;
  const searchQuery = (elements.filterSearch.value || '').toLowerCase().trim();

  let filtered = members;

  // Status filter
  if (statusFilter) {
    filtered = statusFilter === 'bureau' ? filtered.filter(m => BUREAU_STATUSES.has(m.status)) : filtered.filter(m => m.status === statusFilter);
  }

  // Track filter
  if (trackFilter) filtered = filtered.filter(m => m.enrollment_track === trackFilter);

  // Search filter
  if (searchQuery) {
    filtered = filtered.filter(m => {
      const searchFields = [
        m.first_name, m.last_name, m.email, m.student_id,
        m.phone, m.telegram, m.discord, m.enrollment_track, m.notes
      ].filter(Boolean).join(' ').toLowerCase();
      return searchFields.includes(searchQuery);
    });
  }

  elements.membersBadge.textContent = filtered.length;

  // Update selection to only include visible members
  const visibleIds = new Set(filtered.map(m => m.id));
  selectedMembers = new Set([...selectedMembers].filter(id => visibleIds.has(id)));
  updateSelectionUI();

  if (filtered.length === 0) {
    elements.membersContainer.innerHTML = '<p class="text-muted">Aucun membre trouvé</p>';
    return;
  }

  // Apply sorting
  filtered = sortMembers(filtered);

  const allSelected = filtered.length > 0 && filtered.every(m => selectedMembers.has(m.id));

  elements.membersContainer.innerHTML = `
    <table class="data-table members-table-wide">
      <thead>
        <tr>
          <th class="checkbox-col">
            <input type="checkbox" id="select-all" ${allSelected ? 'checked' : ''} onchange="window.adminDashboard.toggleSelectAll(this.checked)">
          </th>
          <th class="sortable" onclick="window.adminDashboard.toggleSort('last_name')">Nom${getSortIcon('last_name')}</th>
          <th class="sortable" onclick="window.adminDashboard.toggleSort('email')">Email${getSortIcon('email')}</th>
          <th class="sortable" onclick="window.adminDashboard.toggleSort('student_id')">N° Étudiant${getSortIcon('student_id')}</th>
          <th class="sortable" onclick="window.adminDashboard.toggleSort('enrollment_track')">Cursus${getSortIcon('enrollment_track')}</th>
          <th>Contact</th>
          <th class="sortable" onclick="window.adminDashboard.toggleSort('status')">Statut${getSortIcon('status')}</th>
          <th class="sortable" onclick="window.adminDashboard.toggleSort('created_at')">Inscription${getSortIcon('created_at')}</th>
          <th class="actions-col">Actions</th>
        </tr>
      </thead>
      <tbody>
        ${filtered.map(m => {
          let notesPreview = '';
          if (m.notes) {
            const ellipsis = m.notes.length > 50 ? '...' : '';
            notesPreview = m.notes.slice(0, 50) + ellipsis;
          }
          const notesHtml = notesPreview ? `<br><small class="text-muted">${escapeHtml(notesPreview)}</small>` : '';
          return `
          <tr data-id="${m.id}" class="${selectedMembers.has(m.id) ? 'selected' : ''}">
            <td class="checkbox-col">
              <input type="checkbox" ${selectedMembers.has(m.id) ? 'checked' : ''} onchange="window.adminDashboard.toggleMemberSelection(${m.id}, this.checked)">
            </td>
            <td>
              <strong>${escapeHtml(m.first_name)} ${escapeHtml(m.last_name)}</strong>
              ${notesHtml}
            </td>
            <td><a href="mailto:${escapeHtml(m.email)}">${escapeHtml(m.email)}</a></td>
            <td>${m.student_id ? escapeHtml(m.student_id) : '<span class="text-muted">-</span>'}</td>
            <td>${escapeHtml(m.enrollment_track)}</td>
            <td class="contact-cell">${getContactInfo(m)}</td>
            <td><span class="badge badge-${getStatusClass(m.status)}">${getStatusLabel(m.status)}</span></td>
            <td>${formatDate(m.created_at, true)}</td>
            <td class="actions-col">
              <div class="action-buttons">
                <button class="icon-btn" onclick="window.adminDashboard.editMember(${m.id})" title="Modifier" aria-label="Modifier le membre">􀈊</button>
                ${m.status === 'pending' ? `<button class="icon-btn success" onclick="window.adminDashboard.approveMember(${m.id})" title="Approuver" aria-label="Approuver le membre">􀁢</button>` : ''}
                <button class="icon-btn danger" onclick="window.adminDashboard.confirmDeleteMember(${m.id})" title="Supprimer" aria-label="Supprimer le membre">􀈑</button>
              </div>
            </td>
          </tr>
        `;}).join('')}
      </tbody>
    </table>
  `;
}

function updateSelectionUI() {
  const elements = getElements();
  const count = selectedMembers.size;
  elements.selectionCount.textContent = `${count} sélectionné(s)`;

  if (count > 0) {
    elements.bulkActions.classList.remove('hidden');
  } else {
    elements.bulkActions.classList.add('hidden');
  }
}

export function toggleSelectAll(checked) {
  const elements = getElements();
  const statusFilter = elements.filterStatus.value;
  const trackFilter = elements.filterTrack.value;
  const searchQuery = (elements.filterSearch.value || '').toLowerCase().trim();

  let filtered = membersData;
  if (statusFilter) {
    filtered = statusFilter === 'bureau' ? filtered.filter(m => BUREAU_STATUSES.has(m.status)) : filtered.filter(m => m.status === statusFilter);
  }
  if (trackFilter) filtered = filtered.filter(m => m.enrollment_track === trackFilter);
  if (searchQuery) {
    filtered = filtered.filter(m => {
      const searchFields = [m.first_name, m.last_name, m.email, m.student_id, m.phone, m.telegram, m.discord, m.enrollment_track, m.notes].filter(Boolean).join(' ').toLowerCase();
      return searchFields.includes(searchQuery);
    });
  }

  if (checked) {
    for (const m of filtered) selectedMembers.add(m.id);
  } else {
    selectedMembers.clear();
  }
  renderMembers(membersData);
}

export function toggleMemberSelection(id, checked) {
  if (checked) {
    selectedMembers.add(id);
  } else {
    selectedMembers.delete(id);
  }
  updateSelectionUI();

  // Update row styling
  const row = document.querySelector(`tr[data-id="${id}"]`);
  if (row) {
    row.classList.toggle('selected', checked);
  }

  // Update select-all checkbox
  const selectAll = $('select-all');
  if (selectAll) {
    const visibleRows = document.querySelectorAll('#members-container tbody tr');
    const allChecked = [...visibleRows].every(row => selectedMembers.has(Number.parseInt(row.dataset.id)));
    selectAll.checked = allChecked && visibleRows.length > 0;
  }
}

function getContactInfo(m) {
  const contacts = [];
  if (m.phone) contacts.push(`Tel: ${escapeHtml(m.phone)}`);
  if (m.telegram) contacts.push(`TG: ${escapeHtml(m.telegram)}`);
  if (m.discord) contacts.push(`DC: ${escapeHtml(m.discord)}`);
  return contacts.length > 0 ? contacts.join('<br>') : '-';
}

function getStatusClass(status) {
  const classes = {
    'active': 'success',
    'pending': 'warning',
    'rejected': 'error',
    'expired': 'secondary'
  };
  return classes[status] || 'secondary';
}

function getStatusLabel(status) {
  const labels = {
    'active': 'Actif',
    'pending': 'En attente',
    'rejected': 'Refusé',
    'expired': 'Expiré'
  };
  return labels[status] || status;
}

function formatDate(dateStr, includeTime = false) {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  if (includeTime) {
    return date.toLocaleDateString('fr-FR') + ' ' + date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString('fr-FR');
}

function populateTrackFilter(members) {
  const elements = getElements();
  const tracks = [...new Set(members.map(m => m.enrollment_track))].sort();
  elements.filterTrack.innerHTML = '<option value="">Tous les cursus</option>' +
    tracks.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
}

// ============================================================
// MEMBER ACTIONS
// ============================================================

export async function approveMember(id) {
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

export async function rejectMember(id) {
  $(EL_CONFIRM_MESSAGE).textContent = 'Êtes-vous sûr de vouloir refuser cette demande ?';
  const elements = getElements();
  elements.confirmBtn.onclick = async () => {
    try {
      await api(`/admin/members/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'rejected', reason: 'Rejected by admin' })
      });
      toastSuccess('Demande refusée');
      closeModal(EL_CONFIRM_MODAL);
      loadData();
    } catch (error) {
      toastError(error.message);
    }
  };
  openModal(EL_CONFIRM_MODAL);
}

export function editMember(id) {
  const member = membersData.find(m => m.id === id);
  if (!member) return;

  $('member-modal-title').textContent = 'Modifier le membre';
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

export function confirmDeleteMember(id) {
  const member = membersData.find(m => m.id === id);
  $(EL_CONFIRM_MESSAGE).textContent = `Êtes-vous sûr de vouloir supprimer ${member?.first_name} ${member?.last_name} ?`;
  const elements = getElements();
  elements.confirmBtn.onclick = async () => {
    try {
      await api(`/admin/members/${id}`, { method: 'DELETE' });
      toastSuccess('Membre supprimé');
      closeModal(EL_CONFIRM_MODAL);
      loadData();
    } catch (error) {
      toastError(error.message);
    }
  };
  openModal(EL_CONFIRM_MODAL);
}

async function handleMemberSubmit(e) {
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

async function approveAll() {
  const pending = membersData.filter(m => m.status === 'pending');
  if (pending.length === 0) return;

  $(EL_CONFIRM_MESSAGE).textContent = `Approuver ${pending.length} demande(s) ?`;
  const elements = getElements();
  elements.confirmBtn.className = 'btn btn-primary';
  elements.confirmBtn.textContent = 'Approuver';
  elements.confirmBtn.onclick = async () => {
    try {
      await api('/admin/members/batch', {
        method: 'POST',
        body: JSON.stringify({
          memberIds: pending.map(m => m.id),
          status: 'active',
          reason: 'Batch approved by admin'
        })
      });
      toastSuccess(`${pending.length} membre(s) approuvé(s)`);
      closeModal(EL_CONFIRM_MODAL);
      loadData();
    } catch (error) {
      toastError(error.message);
    }
  };
  openModal(EL_CONFIRM_MODAL);
}

// ============================================================
// BULK ACTIONS
// ============================================================

export async function bulkApprove() {
  if (selectedMembers.size === 0) return;

  const ids = [...selectedMembers];
  $(EL_CONFIRM_MESSAGE).textContent = `Approuver ${ids.length} membre(s) sélectionné(s) ?`;
  const elements = getElements();
  elements.confirmBtn.className = 'btn btn-primary';
  elements.confirmBtn.textContent = 'Approuver';
  elements.confirmBtn.onclick = async () => {
    try {
      await api('/admin/members/batch', {
        method: 'POST',
        body: JSON.stringify({
          memberIds: ids,
          status: 'active',
          reason: 'Bulk approved by admin'
        })
      });
      toastSuccess(`${ids.length} membre(s) approuvé(s)`);
      selectedMembers.clear();
      closeModal(EL_CONFIRM_MODAL);
      loadData();
    } catch (error) {
      toastError(error.message);
    }
  };
  openModal(EL_CONFIRM_MODAL);
}

export async function bulkSetStatus(newStatus) {
  if (selectedMembers.size === 0) return;

  const ids = [...selectedMembers];
  const statusLabel = STATUS_LABELS[newStatus] || newStatus;

  $(EL_CONFIRM_MESSAGE).textContent = `Définir ${ids.length} membre(s) comme "${statusLabel}" ?`;
  const elements = getElements();
  elements.confirmBtn.className = 'btn btn-primary';
  elements.confirmBtn.textContent = 'Confirmer';
  elements.confirmBtn.onclick = async () => {
    try {
      await api('/admin/members/batch', {
        method: 'POST',
        body: JSON.stringify({
          memberIds: ids,
          status: newStatus,
          reason: `Bulk status change to ${newStatus} by admin`
        })
      });
      toastSuccess(`${ids.length} membre(s) mis à jour`);
      selectedMembers.clear();
      closeModal(EL_CONFIRM_MODAL);
      loadData();
    } catch (error) {
      toastError(error.message);
    }
  };
  openModal(EL_CONFIRM_MODAL);
}

export async function bulkDelete() {
  if (selectedMembers.size === 0) return;

  const ids = [...selectedMembers];
  $(EL_CONFIRM_MESSAGE).innerHTML = `<strong style="color: var(--color-error);">Supprimer définitivement ${ids.length} membre(s) ?</strong><br><small>Cette action est irréversible.</small>`;
  const elements = getElements();
  elements.confirmBtn.className = 'btn btn-danger';
  elements.confirmBtn.textContent = 'Supprimer';
  elements.confirmBtn.onclick = async () => {
    try {
      // Delete one by one (no batch delete endpoint yet)
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
      selectedMembers.clear();
      closeModal(EL_CONFIRM_MODAL);
      loadData();
    } catch (error) {
      toastError(error.message);
    }
  };
  openModal(EL_CONFIRM_MODAL);
}

// ============================================================
// DATA LOADING
// ============================================================

async function loadData() {
  try {
    const data = await api('/admin/members');
    membersData = data.members || [];
    statsData = data.stats;

    renderStats(statsData);
    renderBureau(membersData);
    renderPendingApplications(membersData);
    renderMembers(membersData);
    populateTrackFilter(membersData);
  } catch (error) {
    if (error.message === 'Unauthorized') {
      showAuth();
      toastError('Session expirée');
    } else {
      toastError(error.message);
    }
    throw error; // Re-throw to let caller know loading failed
  }
}

async function handleExport() {
  try {
    const elements = getElements();
    const status = elements.filterStatus.value;
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

// ============================================================
// IMPORT CSV
// ============================================================

function handleImportFileChange(event) {
  const elements = getElements();
  const file = event.target.files[0];
  if (!file) {
    elements.importBtn.disabled = true;
    elements.importPreview.classList.add('hidden');
    importData = null;
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    importData = e.target.result;

    // Show preview
    const lines = importData.trim().split('\n').slice(0, 6);
    const previewHtml = lines.map((line, i) => {
      const cells = line.split(/[,;\t]/).slice(0, 5);
      return `<tr class="${i === 0 ? 'header-row' : ''}">
        ${cells.map(c => `<td>${escapeHtml(c.replaceAll(/(?:^")|(?:"$)/g, '').trim())}</td>`).join('')}
        ${cells.length < 5 ? '<td>...</td>' : ''}
      </tr>`;
    }).join('');

    elements.importPreviewContent.innerHTML = `
      <table class="data-table" style="font-size: var(--text-xs);">
        <tbody>${previewHtml}</tbody>
      </table>
      <p style="color: var(--color-text-muted); margin-top: var(--space-2);">
        ${importData.trim().split('\n').length - 1} ligne(s) de données
      </p>
    `;
    elements.importPreview.classList.remove('hidden');
    elements.importBtn.disabled = false;
  };
  reader.readAsText(file);
}

async function handleImport() {
  if (!importData) return;

  const elements = getElements();
  elements.importBtn.disabled = true;
  elements.importBtn.textContent = 'Import en cours...';

  try {
    const result = await api('/admin/import', {
      method: 'POST',
      body: JSON.stringify({ csv: importData })
    });

    const stats = result.stats;
    let message = `Import terminé: ${stats.imported} ajouté(s), ${stats.updated} mis à jour`;
    if (stats.skipped > 0) message += `, ${stats.skipped} ignoré(s)`;

    elements.importResult.innerHTML = `
      <div class="toast success" style="position: static; transform: none;">
        ${message}
      </div>
      ${result.errors ? `
        <div style="margin-top: var(--space-2); color: var(--color-error); font-size: var(--text-sm);">
          <strong>Erreurs:</strong>
          <ul>${result.errors.map(e => `<li>${escapeHtml(e)}</li>`).join('')}</ul>
        </div>
      ` : ''}
    `;
    elements.importResult.classList.remove('hidden');

    toastSuccess(message);
    loadData();

    // Reset form
    elements.importFile.value = '';
    elements.importPreview.classList.add('hidden');
    importData = null;
  } catch (error) {
    toastError(error.message);
    elements.importResult.innerHTML = `
      <div class="toast error" style="position: static; transform: none;">
        Erreur: ${escapeHtml(error.message)}
      </div>
    `;
    elements.importResult.classList.remove('hidden');
  }

  elements.importBtn.disabled = true;
  elements.importBtn.textContent = 'Importer';
}

// ============================================================
// AUTH
// ============================================================

function showAuth() {
  const elements = getElements();
  elements.authSection.classList.remove('hidden');
  elements.adminContent.classList.add('hidden');
}

function showAdmin() {
  const elements = getElements();
  elements.authSection.classList.add('hidden');
  elements.adminContent.classList.remove('hidden');
}

function showAuthError(message) {
  const elements = getElements();
  elements.authError.textContent = message;
  elements.authError.classList.remove('hidden');
}

async function handleAuth() {
  const elements = getElements();
  const token = elements.tokenInput.value.trim();
  if (!token) {
    showAuthError('Token requis');
    return;
  }

  adminToken = token;
  elements.authError.classList.add('hidden');

  try {
    await loadData();
    localStorage.setItem('join_admin_token', token);
    showAdmin();
  } catch (error) {
    if (error.message === 'Unauthorized') {
      showAuthError('Token invalide');
      adminToken = '';
      localStorage.removeItem('join_admin_token');
    } else {
      showAuthError(error.message);
    }
  }
}

// ============================================================
// SETTINGS
// ============================================================

async function loadSettings() {
  const { settings } = await api('/admin/settings');
  // Handle both boolean and string values
  const isOpen = settings.membership_open === true || settings.membership_open === 'true';
  $('setting-membership-open').checked = isOpen;
  $('setting-current-year').value = settings.current_year || '2024-2025';
  // Reset dirty state after loading
  const elements = getElements();
  elements.saveSettingsBtn.disabled = true;
}

async function saveSettings() {
  try {
    await api('/admin/settings', {
      method: 'PUT',
      body: JSON.stringify({
        membership_open: $('setting-membership-open').checked ? 'true' : 'false',
        current_year: $('setting-current-year').value
      })
    });
    toastSuccess('Paramètres enregistrés');
    const elements = getElements();
    elements.saveSettingsBtn.disabled = true;
  } catch (error) {
    toastError(error.message);
  }
}

function markSettingsDirty() {
  const elements = getElements();
  elements.saveSettingsBtn.disabled = false;
}

// ============================================================
// DOM ELEMENTS
// ============================================================

function getElements() {
  return {
    authSection: $('auth-section'),
    adminContent: $('admin-content'),
    tokenInput: $('admin-token'),
    authBtn: $('auth-btn'),
    authError: $('auth-error'),
    statsGrid: $('stats-grid'),
    bureauContainer: $('bureau-container'),
    pendingContainer: $('pending-container'),
    pendingBadge: $('pending-badge'),
    membersContainer: $('members-container'),
    membersBadge: $('members-badge'),
    filterSearch: $('filter-search'),
    filterStatus: $('filter-status'),
    filterTrack: $('filter-track'),
    bulkActions: $('bulk-actions'),
    selectionCount: $('selection-count'),
    exportBtn: $('export-btn'),
    refreshBtn: $('refresh-btn'),
    approveAllBtn: $('approve-all-btn'),
    memberModal: $('member-modal'),
    memberForm: $('member-form'),
    confirmModal: $('confirm-modal'),
    confirmBtn: $('confirm-btn'),
    saveSettingsBtn: $('save-settings-btn'),
    importFile: $('import-file'),
    importBtn: $('import-btn'),
    importPreview: $('import-preview'),
    importPreviewContent: $('import-preview-content'),
    importResult: $('import-result')
  };
}

// ============================================================
// INIT
// ============================================================

export async function initAdminDashboard() {
  const elements = getElements();

  // Initialize sidebar navigation
  initSidebar();

  elements.authBtn.addEventListener('click', handleAuth);
  elements.tokenInput.addEventListener('keypress', e => {
    if (e.key === 'Enter') handleAuth();
  });
  elements.exportBtn.addEventListener('click', handleExport);
  elements.refreshBtn.addEventListener('click', () => {
    loadData();
    toastSuccess('Données actualisées');
  });
  elements.approveAllBtn.addEventListener('click', approveAll);
  elements.memberForm.addEventListener('submit', handleMemberSubmit);
  elements.filterSearch.addEventListener('input', debounce(() => renderMembers(membersData), 300));
  elements.filterStatus.addEventListener('change', () => renderMembers(membersData));
  elements.filterTrack.addEventListener('change', () => renderMembers(membersData));
  elements.saveSettingsBtn.addEventListener('click', saveSettings);
  elements.importFile.addEventListener('change', handleImportFileChange);
  elements.importBtn.addEventListener('click', handleImport);

  $('setting-membership-open').addEventListener('change', markSettingsDirty);
  $('setting-current-year').addEventListener('input', markSettingsDirty);

  // Modal close on backdrop
  for (const modal of document.querySelectorAll('.modal')) {
    modal.addEventListener('click', e => {
      if (e.target === modal) modal.classList.add('hidden');
    });
  }

  // Auto-login if token exists
  if (adminToken) {
    try {
      await loadData();
      await loadSettings();
      showAdmin();
    } catch {
      showAuth();
      localStorage.removeItem('join_admin_token');
      adminToken = '';
    }
  } else {
    showAuth();
  }
}
