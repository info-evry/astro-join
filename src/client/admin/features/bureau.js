/**
 * Bureau tab: read-only listing of members holding an officer status.
 */
import { $, escapeHtml } from '@info-evry/astro-design/scripts/dom';
import { BUREAU_ROLES, isBureauRole, statusLabel } from '../../../shared/membership.js';
import { state } from '../state.js';

export function renderBureau(members) {
  const container = $('bureau-container');
  const bureau = members.filter((m) => isBureauRole(m.status));

  if (bureau.length === 0) {
    container.innerHTML = '<p class="text-muted">Aucun membre du bureau défini</p>';
    return;
  }

  bureau.sort((a, b) => BUREAU_ROLES.indexOf(a.status) - BUREAU_ROLES.indexOf(b.status));

  container.innerHTML = `
    <div class="bureau-grid">
      ${bureau.map((m) => `
        <div class="bureau-card">
          <div class="bureau-role">${escapeHtml(statusLabel(m.status))}</div>
          <div class="bureau-name">${escapeHtml(m.first_name)} ${escapeHtml(m.last_name)}</div>
          <div class="bureau-email"><a href="mailto:${escapeHtml(m.email)}">${escapeHtml(m.email)}</a></div>
          <div class="bureau-actions">
            <button class="icon-btn" data-action="edit-member" data-member-id="${m.id}" title="Modifier" aria-label="Modifier le membre">􀈊</button>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

export function loadBureau() {
  renderBureau(state.members);
}
