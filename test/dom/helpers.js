/**
 * Shared helpers for the admin dashboard DOM tests.
 */
/* global document, MouseEvent, Event */
import { vi, beforeEach, afterEach } from 'vitest';

/** Markup mirroring src/components/admin/ManagePage.astro (ids and data attributes). */
export const ADMIN_DOM = `
  <section id="auth-section" class="section">
    <input type="password" id="admin-token">
    <button type="button" id="auth-btn">Connexion</button>
    <p id="auth-error" class="error-text hidden"></p>
  </section>
  <div id="admin-content" class="hidden">
    <nav class="admin-sidebar">
      <button data-tab="members" class="active">Membres <span id="members-badge" class="hidden">0</span></button>
      <button data-tab="pending">En attente <span id="pending-badge" class="hidden">0</span></button>
      <button data-tab="bureau">Bureau</button>
      <button data-tab="import">Import</button>
      <button data-tab="settings">Paramètres</button>
    </nav>
    <div id="panel-members" class="tab-panel">
      <button type="button" id="export-btn">Exporter CSV</button>
      <button type="button" id="refresh-btn">Rafraîchir</button>
      <div id="stats-grid"></div>
      <input type="search" id="filter-search">
      <select id="filter-status">
        <option value="">Tous les statuts</option>
        <option value="active">Membres actifs</option>
        <option value="honor">Membres d'honneur</option>
        <option value="honorary_president">Présidents d'honneur</option>
        <option value="bureau">Bureau</option>
        <option value="pending">En attente</option>
        <option value="rejected">Refusés</option>
        <option value="expired">Expirés</option>
      </select>
      <select id="filter-track"><option value="">Tous les cursus</option></select>
      <div id="bulk-actions" class="hidden">
        <span id="selection-count">0 sélectionné(s)</span>
        <button type="button" data-action="bulk-approve">Approuver</button>
        <button type="button" data-action="bulk-set-status" data-status="active">Actif</button>
        <button type="button" data-action="bulk-set-status" data-status="honor">Honneur</button>
        <button type="button" data-action="bulk-set-status" data-status="expired">Expiré</button>
        <button type="button" data-action="bulk-delete">Supprimer</button>
      </div>
      <div id="members-container"></div>
    </div>
    <div id="panel-pending" class="tab-panel hidden">
      <button type="button" id="approve-all-btn" data-action="approve-all" disabled>Tout approuver</button>
      <div id="pending-container"></div>
    </div>
    <div id="panel-bureau" class="tab-panel hidden"><div id="bureau-container"></div></div>
    <div id="panel-import" class="tab-panel hidden">
      <input type="file" id="import-file">
      <div id="import-preview" class="hidden"><div id="import-preview-content"></div></div>
      <button type="button" id="import-btn" disabled>Importer</button>
      <div id="import-result" class="hidden"></div>
    </div>
    <div id="panel-settings" class="tab-panel hidden">
      <button type="button" id="save-settings-btn" disabled>Enregistrer</button>
      <input type="checkbox" id="setting-membership-open" checked>
      <input type="text" id="setting-current-year" value="2024-2025">
    </div>
  </div>
  <div id="member-modal" class="modal hidden">
    <form id="member-form">
      <input type="hidden" id="member-form-id">
      <input type="text" id="member-form-firstname">
      <input type="text" id="member-form-lastname">
      <input type="email" id="member-form-email">
      <input type="text" id="member-form-studentid">
      <input type="text" id="member-form-track">
      <select id="member-form-status">
        <option value="pending">En attente</option>
        <option value="active">Membre actif</option>
        <option value="secretary">Secrétaire</option>
      </select>
      <textarea id="member-form-notes"></textarea>
    </form>
  </div>
  <div id="confirm-modal" class="modal hidden">
    <p id="confirm-message"></p>
    <button type="button" id="confirm-btn">Confirmer</button>
  </div>
`;

/** The classic XSS probes the admin tables must neutralise. */
export const XSS_ATTRIBUTE = '"><img src=x onerror=alert(1)>';
export const XSS_APOSTROPHE = "O'Brien' onmouseover='alert(1)";

export function mountAdminDom() {
  document.body.innerHTML = ADMIN_DOM;
}

/** Element by id; throws a clear error when the fixture is missing it. */
export function byId(id) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`#${id} not found in the DOM`);
  return element;
}

let nextId = 1;
/** Build a member row as returned by GET /api/admin/members. */
export function makeMember(overrides = {}) {
  const id = overrides.id ?? nextId++;
  return {
    id,
    first_name: `First${id}`,
    last_name: `Last${id}`,
    email: `member${id}@test.example`,
    student_id: null,
    phone: null,
    telegram: null,
    discord: null,
    enrollment_track: 'L3 Informatique',
    status: 'active',
    notes: null,
    created_at: '2025-03-15 12:00:00',
    approved_at: null,
    expires_at: null,
    ...overrides
  };
}

/** Minimal fetch Response stand-in that resolves on microtasks only. */
export function jsonResponse(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => (name.toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: async () => data
  };
}

export function csvResponse(text) {
  return {
    ok: true,
    status: 200,
    headers: { get: (name) => (name.toLowerCase() === 'content-type' ? 'text/csv; charset=utf-8' : null) },
    blob: async () => ({ size: text.length, text })
  };
}

/** Let pending promise chains (mocked fetch/api) run to completion. */
export async function settle() {
  for (let i = 0; i < 25; i++) await Promise.resolve();
}

/** The currently visible toast, or null. */
export function currentToast() {
  return document.querySelector('.toast');
}

export function isHidden(id) {
  return byId(id).classList.contains('hidden');
}

/**
 * Remove every listener a test adds to `document`, so modules that bind
 * delegated handlers on import/init never double-fire across tests.
 */
export function isolateDocumentListeners() {
  const added = [];
  beforeEach(() => {
    const original = document.addEventListener.bind(document);
    vi.spyOn(document, 'addEventListener').mockImplementation((type, listener, options) => {
      added.push([type, listener, options]);
      original(type, listener, options);
    });
  });
  afterEach(() => {
    for (const [type, listener, options] of added.splice(0)) {
      document.removeEventListener(type, listener, options);
    }
  });
}

/** Attribute names starting with "on" anywhere under `root` (inline handlers). */
export function inlineHandlerAttributes(root) {
  const found = [];
  for (const element of root.querySelectorAll('*')) {
    for (const attribute of element.attributes) {
      if (attribute.name.toLowerCase().startsWith('on')) found.push(`${element.tagName.toLowerCase()}[${attribute.name}]`);
    }
  }
  return found;
}

/** Click an element the way a browser would (bubbling, cancelable). */
export function click(element) {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true });
  element.dispatchEvent(event);
  return event;
}

export function change(element) {
  element.dispatchEvent(new Event('change', { bubbles: true }));
}
