/**
 * Membership Admin Dashboard - entry point
 *
 * Bootstraps the admin dashboard: creates the API client, wires the
 * auth/refresh/tab/modal behavior, and loads data for every tab.
 *
 * Authentication (stored-token auto-login, login button and Enter key, error
 * messages, session expiry) is astro-design's `createAdminShell`: the stored
 * token is cleared ONLY when the server answers 401, never on a network error
 * or a 5xx.
 */
import { $ } from '@info-evry/astro-design/scripts/dom';
import { toastSuccess, toastError } from '@info-evry/astro-design/scripts/toast';
import { initModals } from '@info-evry/astro-design/scripts/modal';
import { initTabs } from '@info-evry/astro-design/scripts/tabs';
import { createApiClient } from '@info-evry/astro-design/scripts/api-client';
import { createAdminShell } from '@info-evry/astro-design/scripts/admin-shell';
import { bindDelegation } from '@info-evry/astro-design/scripts/delegation';
import { statCardHtml } from '@info-evry/astro-design/scripts/templates';
import { setMembersData } from './state.js';
import { buildActions } from './actions.js';
import { renderMembers, populateTrackFilter, initMembers } from './features/members.js';
import { renderPendingApplications } from './features/pending.js';
import { renderBureau } from './features/bureau.js';
import { initImport } from './features/import.js';
import { loadSettings, initSettings } from './features/settings.js';

const client = createApiClient({ tokenKey: 'join_admin_token' });
const { api } = client;

function renderStats(stats) {
  $('stats-grid').innerHTML = [
    statCardHtml({ value: stats.active, label: 'Membres actifs' }),
    statCardHtml({ value: stats.pending, label: 'En attente' }),
    statCardHtml({ value: stats.total, label: 'Total' }),
    statCardHtml({ value: stats.expired, label: 'Expirés' })
  ].join('');
}

/** Fetch and render the members. Throws on failure: the admin shell decides what a 401 or a network error means. */
async function loadData() {
  const data = await api('/admin/members');
  const members = data.members || [];
  setMembersData(members, data.stats);

  renderStats(data.stats);
  renderBureau(members);
  renderPendingApplications(members);
  renderMembers(members);
  populateTrackFilter(members);
}

/** Modules that need an authenticated session; the shell runs this once, after the first successful login. */
async function initAuthedModules() {
  initImport(api, reloadData);
  initSettings(api);
  await loadSettings(api);
}

const shell = createAdminShell({
  api: client,
  selectors: {
    authSection: '#auth-section',
    adminContent: '#admin-content',
    tokenInput: '#admin-token',
    authBtn: '#auth-btn',
    authError: '#auth-error'
  },
  load: loadData,
  afterLogin: initAuthedModules
});

/**
 * Reload for fire-and-forget callers (feature modules, refresh button): never
 * throws; a 401 goes back to the login screen, other failures are toasted.
 * @returns {Promise<boolean>} whether the reload succeeded
 */
function reloadData() {
  return shell.reload();
}

async function init() {
  const { actions, changes } = buildActions({ api, loadData: reloadData });
  bindDelegation(actions, changes, { onError: (error) => toastError(error.message) });

  initTabs();
  initModals();
  initMembers(api, reloadData);

  $('refresh-btn').addEventListener('click', async () => {
    if (await reloadData()) toastSuccess('Données actualisées');
  });
  await shell.init();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init(); // eslint-disable-line unicorn/prefer-top-level-await -- IIFE pattern for broader compatibility
}
