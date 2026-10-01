/* global localStorage, KeyboardEvent, Event */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  mountAdminDom, byId, makeMember, jsonResponse, settle, currentToast, isHidden,
  isolateDocumentListeners, click
} from './helpers.js';

const TOKEN_KEY = 'join_admin_token';

isolateDocumentListeners();

/**
 * In-memory stand-in for the admin API. `validToken` can be changed mid-test
 * to simulate an expired session.
 */
function createServer({ members = [], settings, validToken = 'good-token' } = {}) {
  const server = {
    members,
    settings: settings ?? { membership_open: true, current_year: '2025-2026' },
    validToken,
    failMembersWith: null,
    calls: []
  };

  server.fetch = vi.fn(async (url, options = {}) => {
    const method = options.method ?? 'GET';
    server.calls.push({ url, method, authorization: options.headers?.Authorization, body: options.body });

    if (options.headers?.Authorization !== `Bearer ${server.validToken}`) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }
    if (url === '/api/admin/members' && method === 'GET') {
      if (server.failMembersWith) return jsonResponse({ error: server.failMembersWith }, 500);
      return jsonResponse({
        members: server.members,
        stats: { total: server.members.length, active: 2, pending: 1, rejected: 0, expired: 4 }
      });
    }
    if (url === '/api/admin/settings' && method === 'GET') {
      return jsonResponse({ settings: server.settings });
    }
    const memberMatch = /^\/api\/admin\/members\/(\d+)$/.exec(url);
    if (memberMatch && method === 'PUT') {
      const member = server.members.find((m) => m.id === Number(memberMatch[1]));
      Object.assign(member, JSON.parse(options.body));
      return jsonResponse({ success: true });
    }
    return jsonResponse({ error: 'Not Found' }, 404);
  });
  return server;
}

let server;

/** Import main.js fresh against the current DOM/localStorage and let init settle. */
async function bootAdmin() {
  vi.resetModules();
  vi.stubGlobal('fetch', server.fetch);
  await import('../../src/client/admin/main.js');
  await settle();
}

async function logIn(token = 'good-token') {
  byId('admin-token').value = token;
  click(byId('auth-btn'));
  await settle();
}

const expectLoginScreen = () => {
  expect(isHidden('auth-section')).toBe(false);
  expect(isHidden('admin-content')).toBe(true);
};
const expectAdminScreen = () => {
  expect(isHidden('auth-section')).toBe(true);
  expect(isHidden('admin-content')).toBe(false);
};
const rowIds = () => [...byId('members-container').querySelectorAll('tbody tr')].map((row) => Number(row.dataset.id));

beforeEach(() => {
  vi.useFakeTimers();
  mountAdminDom();
  // The page ships with the login form visible and the dashboard hidden.
  byId('auth-section').classList.remove('hidden');
  server = createServer({
    members: [
      makeMember({ id: 1, status: 'pending', first_name: 'Ada' }),
      makeMember({ id: 2, status: 'active', first_name: 'Bob' }),
      makeMember({ id: 3, status: 'president', first_name: 'Cy' })
    ]
  });
});

afterEach(() => vi.useRealTimers());

describe('start-up', () => {
  it('shows the login form and makes no request without a stored token', async () => {
    await bootAdmin();

    expectLoginScreen();
    expect(server.fetch).not.toHaveBeenCalled();
  });

  it('opens the dashboard straight away with a valid stored token', async () => {
    localStorage.setItem(TOKEN_KEY, 'good-token');
    await bootAdmin();

    expectAdminScreen();
    expect(server.calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      'GET /api/admin/members', 'GET /api/admin/settings'
    ]);
    expect(server.calls.every((call) => call.authorization === 'Bearer good-token')).toBe(true);
    expect(localStorage.getItem(TOKEN_KEY)).toBe('good-token');
  });

  it('renders stats, tables, bureau and settings from the loaded data', async () => {
    localStorage.setItem(TOKEN_KEY, 'good-token');
    // GET /api/admin/settings returns parsed values: a real boolean
    server.settings = { membership_open: false, current_year: '2031-2032' };
    await bootAdmin();

    expect(byId('stats-grid').children).toHaveLength(4);
    expect(byId('stats-grid').textContent).toMatch(/Membres actifs/);
    expect(rowIds().sort()).toEqual([1, 2, 3]);
    expect(byId('pending-container').querySelectorAll('tbody tr')).toHaveLength(1);
    expect(byId('bureau-container').querySelectorAll('.bureau-card')).toHaveLength(1);
    expect(byId('filter-track').options.length).toBeGreaterThan(1);
    expect(byId('setting-membership-open').checked).toBe(false);
    expect(byId('setting-current-year').value).toBe('2031-2032');
  });

  it('returns to the login form and forgets a token the server rejected with 401 (silently)', async () => {
    localStorage.setItem(TOKEN_KEY, 'stale-token');
    await bootAdmin();

    expectLoginScreen();
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(isHidden('auth-error')).toBe(true);
    expect(currentToast()).toBeNull();
  });

  it('keeps the stored token and offers a retry when the network fails', async () => {
    localStorage.setItem(TOKEN_KEY, 'good-token');
    server.fetch.mockRejectedValue(new TypeError('Failed to fetch'));
    await bootAdmin();

    expectLoginScreen();
    expect(localStorage.getItem(TOKEN_KEY)).toBe('good-token');
    expect(isHidden('auth-error')).toBe(false);
    expect(byId('auth-error').textContent).toBe('Service momentanément indisponible. Réessayez.');
  });

  it('keeps the stored token when the server answers 5xx', async () => {
    localStorage.setItem(TOKEN_KEY, 'good-token');
    server.failMembersWith = 'Erreur interne';
    await bootAdmin();

    expectLoginScreen();
    expect(localStorage.getItem(TOKEN_KEY)).toBe('good-token');
    expect(byId('auth-error').textContent).toBe('Service momentanément indisponible. Réessayez.');
  });

  it('retries with the stored token when the login button is clicked with an empty input', async () => {
    localStorage.setItem(TOKEN_KEY, 'good-token');
    server.failMembersWith = 'Erreur interne';
    await bootAdmin();
    expectLoginScreen();

    server.failMembersWith = null;
    await logIn('');

    expectAdminScreen();
    expect(localStorage.getItem(TOKEN_KEY)).toBe('good-token');
  });
});

describe('logging in', () => {
  beforeEach(bootAdmin);

  it('accepts a valid token: stores it, shows the dashboard, hides errors', async () => {
    await logIn('good-token');

    expectAdminScreen();
    expect(localStorage.getItem(TOKEN_KEY)).toBe('good-token');
    expect(isHidden('auth-error')).toBe(true);
    expect(rowIds().sort()).toEqual([1, 2, 3]);
  });

  it('trims the token and sends it as a bearer credential', async () => {
    await logIn('  good-token \n');

    expect(localStorage.getItem(TOKEN_KEY)).toBe('good-token');
    expect(server.calls[0].authorization).toBe('Bearer good-token');
  });

  it('logs in with the Enter key but not with other keys', async () => {
    byId('admin-token').value = 'good-token';

    byId('admin-token').dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    await settle();
    expect(server.fetch).not.toHaveBeenCalled();

    byId('admin-token').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await settle();
    expectAdminScreen();
  });

  it.each(['', '   '])('refuses an empty token (%j) without calling the API', async (value) => {
    await logIn(value);

    expect(byId('auth-error').textContent).toBe('Veuillez entrer un token');
    expect(isHidden('auth-error')).toBe(false);
    expect(server.fetch).not.toHaveBeenCalled();
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    expectLoginScreen();
  });

  it('rejects an invalid token: error shown, storage cleared, dashboard stays hidden', async () => {
    await logIn('wrong-token');

    expect(byId('auth-error').textContent).toBe('Token invalide');
    expect(isHidden('auth-error')).toBe(false);
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    expectLoginScreen();
    expect(byId('members-container').querySelector('table')).toBeNull();
  });

  it('keeps the token and shows a retry message for a server failure (only a 401 clears it)', async () => {
    server.failMembersWith = 'Erreur interne';
    await logIn('good-token');

    expect(byId('auth-error').textContent).toBe('Service momentanément indisponible. Réessayez.');
    expect(isHidden('auth-error')).toBe(false);
    expect(localStorage.getItem(TOKEN_KEY)).toBe('good-token');
    expectLoginScreen();
  });

  it('clears the previous error on a new attempt and succeeds with the right token', async () => {
    await logIn('wrong-token');
    expect(isHidden('auth-error')).toBe(false);

    await logIn('good-token');

    expect(isHidden('auth-error')).toBe(true);
    expectAdminScreen();
    expect(localStorage.getItem(TOKEN_KEY)).toBe('good-token');
  });

  it('does not use a rejected token for later requests', async () => {
    await logIn('wrong-token');
    server.calls.length = 0;

    await logIn('good-token');

    expect(server.calls.every((call) => call.authorization === 'Bearer good-token')).toBe(true);
  });
});

describe('session expiry while using the dashboard', () => {
  beforeEach(async () => {
    await bootAdmin();
    await logIn('good-token');
    expectAdminScreen();
  });

  it('refresh reloads the data and confirms with a toast', async () => {
    server.members.push(makeMember({ id: 9, status: 'active' }));
    server.calls.length = 0;

    click(byId('refresh-btn'));
    await settle();

    expect(server.calls[0]).toMatchObject({ method: 'GET', url: '/api/admin/members' });
    expect(rowIds()).toContain(9);
    expect(currentToast().textContent).toBe('Données actualisées');
  });

  it('a 401 on refresh returns to the login form without a success toast', async () => {
    server.validToken = 'rotated-token';

    click(byId('refresh-btn'));
    await settle();

    expectLoginScreen();
    expect(currentToast().textContent).toBe('Session expirée');
    expect(currentToast().classList.contains('error')).toBe(true);
  });

  it('a server error on refresh keeps the dashboard and the token, and shows a generic message', async () => {
    server.failMembersWith = 'Erreur interne';

    click(byId('refresh-btn'));
    await settle();

    expectAdminScreen();
    expect(localStorage.getItem(TOKEN_KEY)).toBe('good-token');
    expect(currentToast().textContent).toBe('Erreur lors du chargement des données');
  });

  it('a network error on refresh keeps the dashboard and the token', async () => {
    server.fetch.mockRejectedValue(new TypeError('Failed to fetch'));

    click(byId('refresh-btn'));
    await settle();

    expectAdminScreen();
    expect(localStorage.getItem(TOKEN_KEY)).toBe('good-token');
    expect(currentToast().classList.contains('error')).toBe(true);
  });

  it('returns to the login form when the reload after an action is unauthorised', async () => {
    // The action itself succeeds, then the follow-up reload finds the session gone.
    server.fetch.mockImplementationOnce(async () => {
      server.validToken = 'rotated-token';
      return jsonResponse({ success: true });
    });

    click(byId('pending-container').querySelector('[data-action="approve-member"]'));
    await settle();

    expectLoginScreen();
    expect(currentToast().textContent).toBe('Session expirée');
  });

  it('can log in again with a fresh token after expiry', async () => {
    server.validToken = 'rotated-token';
    click(byId('refresh-btn'));
    await settle();
    expectLoginScreen();

    await logIn('rotated-token');

    expectAdminScreen();
    expect(localStorage.getItem(TOKEN_KEY)).toBe('rotated-token');
  });
});

describe('delegated actions after login', () => {
  beforeEach(async () => {
    await bootAdmin();
    await logIn('good-token');
  });

  it('approving a pending application PUTs the member and refreshes the lists', async () => {
    server.calls.length = 0;

    click(byId('pending-container').querySelector('[data-action="approve-member"]'));
    await settle();

    expect(server.calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      'PUT /api/admin/members/1', 'GET /api/admin/members'
    ]);
    expect(JSON.parse(server.calls[0].body)).toEqual({ status: 'active', reason: 'Approved by admin' });
    expect(byId('pending-container').textContent).toContain('Aucune demande en attente');
  });

  it('clicking a sortable header re-sorts the members table', async () => {
    click(byId('members-container').querySelector('th[data-field="last_name"]'));
    await settle();

    expect(byId('members-container').querySelector('th[data-field="last_name"]').dataset.sort).toBe('asc');
    expect(rowIds()).toEqual([1, 2, 3]);
  });

  it('ticking a row checkbox shows the bulk bar', async () => {
    const box = byId('members-container').querySelector('tbody input[type="checkbox"]');
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));

    expect(isHidden('bulk-actions')).toBe(false);
    expect(byId('selection-count').textContent).toBe('1 sélectionné(s)');
  });
});
