/**
 * Membership Admin Dashboard - entry point
 *
 * Bootstraps the admin dashboard: creates the API client, wires the
 * auth/refresh/tab/modal behavior, and loads data for every tab.
 */
import { $ } from '@info-evry/astro-design/scripts/dom';
import { toastSuccess, toastError } from '@info-evry/astro-design/scripts/toast';
import { initModals } from '@info-evry/astro-design/scripts/modal';
import { initTabs } from '@info-evry/astro-design/scripts/tabs';
import { createApiClient, ApiError } from '@info-evry/astro-design/scripts/api-client';
import { statCardHtml } from '@info-evry/astro-design/scripts/templates';
import { setMembersData } from './state.js';
import { buildActions, bindDelegation } from './actions.js';
import { renderMembers, populateTrackFilter, initMembers } from './features/members.js';
import { renderPendingApplications } from './features/pending.js';
import { renderBureau } from './features/bureau.js';
import { initImport } from './features/import.js';
import { loadSettings, initSettings } from './features/settings.js';

const { api, setToken, getToken, clearToken } = createApiClient({ tokenKey: 'join_admin_token' });

function renderStats(stats) {
  $('stats-grid').innerHTML = [
    statCardHtml({ value: stats.active, label: 'Membres actifs' }),
    statCardHtml({ value: stats.pending, label: 'En attente' }),
    statCardHtml({ value: stats.total, label: 'Total' }),
    statCardHtml({ value: stats.expired, label: 'Expirés' })
  ].join('');
}

async function loadData() {
  try {
    const data = await api('/admin/members');
    const members = data.members || [];
    setMembersData(members, data.stats);

    renderStats(data.stats);
    renderBureau(members);
    renderPendingApplications(members);
    renderMembers(members);
    populateTrackFilter(members);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      showAuth();
      toastError('Session expirée');
    } else {
      toastError(error.message);
    }
    throw error;
  }
}

function showAuth() {
  $('auth-section').classList.remove('hidden');
  $('admin-content').classList.add('hidden');
}

function showAdmin() {
  $('auth-section').classList.add('hidden');
  $('admin-content').classList.remove('hidden');
}

function showAuthError(message) {
  const authError = $('auth-error');
  authError.textContent = message;
  authError.classList.remove('hidden');
}

let authedModulesReady = false;

function initAuthedModules() {
  if (authedModulesReady) return;
  authedModulesReady = true;
  initImport(api, loadData);
  initSettings(api);
}

async function handleAuth() {
  const token = $('admin-token').value.trim();
  if (!token) {
    showAuthError('Token requis');
    return;
  }

  setToken(token);
  $('auth-error').classList.add('hidden');

  try {
    await loadData();
    await loadSettings(api);
    showAdmin();
    initAuthedModules();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      showAuthError('Token invalide');
      clearToken();
    } else {
      showAuthError(error.message);
    }
  }
}

async function init() {
  const { actions, changes } = buildActions({ api, loadData });
  bindDelegation(actions, changes);

  initTabs();
  initModals();
  initMembers(api, loadData);

  $('auth-btn').addEventListener('click', handleAuth);
  $('admin-token').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleAuth();
  });
  $('refresh-btn').addEventListener('click', () => {
    loadData();
    toastSuccess('Données actualisées');
  });
  if (getToken()) {
    try {
      await loadData();
      await loadSettings(api);
      showAdmin();
      initAuthedModules();
    } catch {
      showAuth();
      clearToken();
    }
  } else {
    showAuth();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init(); // eslint-disable-line unicorn/prefer-top-level-await -- IIFE pattern for broader compatibility
}
