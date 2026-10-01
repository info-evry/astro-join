import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  mountAdminDom, byId, makeMember, settle, currentToast, isHidden, click, inlineHandlerAttributes, XSS_ATTRIBUTE, XSS_APOSTROPHE
} from './helpers.js';

let pending;
let state;
let api;
let loadData;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  mountAdminDom();
  state = (await import('../../src/client/admin/state.js')).state;
  pending = await import('../../src/client/admin/features/pending.js');
  api = vi.fn().mockResolvedValue({ success: true });
  loadData = vi.fn();
});

afterEach(() => vi.useRealTimers());

const container = () => byId('pending-container');
/** Click the confirm button the way a user would (astro-design's confirmAction owns the listener). */
const confirm = async () => {
  click(byId('confirm-btn'));
  await settle();
};

describe('renderPendingApplications', () => {
  it('lists only pending members, newest data as given', () => {
    pending.renderPendingApplications([
      makeMember({ id: 1, status: 'pending' }), makeMember({ id: 2, status: 'active' }), makeMember({ id: 3, status: 'pending' })
    ]);
    expect([...container().querySelectorAll('tbody tr')].map((row) => row.dataset.id)).toEqual(['1', '3']);
  });

  it('wires approve and reject through data attributes with no inline handlers', () => {
    pending.renderPendingApplications([makeMember({ id: 9, status: 'pending' })]);

    expect(inlineHandlerAttributes(container())).toEqual([]);
    expect(container().querySelector('[data-action="approve-member"]').dataset.memberId).toBe('9');
    expect(container().querySelector('[data-action="reject-member"]').dataset.memberId).toBe('9');
  });

  it('enables "approve all" and sets the badge to the pending count', () => {
    pending.renderPendingApplications([makeMember({ status: 'pending' }), makeMember({ status: 'pending' })]);
    expect(byId('approve-all-btn').disabled).toBe(false);
    expect(byId('pending-badge').textContent).toBe('2');
  });

  it('shows a placeholder and disables "approve all" with no pending application', () => {
    pending.renderPendingApplications([makeMember({ status: 'active' })]);
    expect(container().textContent).toContain('Aucune demande en attente');
    expect(container().querySelector('table')).toBeNull();
    expect(byId('approve-all-btn').disabled).toBe(true);
    expect(byId('pending-badge').textContent).toBe('0');
    expect(byId('pending-badge').classList.contains('hidden')).toBe(false);
  });

  it('re-disables "approve all" once the last application is handled', () => {
    pending.renderPendingApplications([makeMember({ status: 'pending' })]);
    pending.renderPendingApplications([]);
    expect(byId('approve-all-btn').disabled).toBe(true);
  });

  it.each([
    ['a quote/tag breakout', XSS_ATTRIBUTE],
    ['apostrophes', XSS_APOSTROPHE],
    ['a script tag', '<script>alert(1)</script>']
  ])('does not create elements or handlers from %s', (_label, payload) => {
    pending.renderPendingApplications([makeMember({
      status: 'pending', first_name: payload, last_name: payload, email: `${payload}@x.fr`,
      enrollment_track: payload, phone: payload, telegram: payload, discord: payload
    })]);

    expect(container().querySelector('img, script')).toBeNull();
    expect(inlineHandlerAttributes(container())).toEqual([]);
    expect(container().querySelectorAll('tbody tr > td')).toHaveLength(6);
    expect(container().querySelector('a').getAttribute('href')).toBe(`mailto:${payload}@x.fr`);
    expect(container().querySelector('tbody td').textContent).toBe(`${payload} ${payload}`);
  });

  it('loadPending renders from the shared state', () => {
    state.members = [makeMember({ id: 4, status: 'pending' })];
    pending.loadPending();
    expect(container().querySelectorAll('tbody tr')).toHaveLength(1);
  });
});

describe('approveMember', () => {
  it('PUTs status active, toasts and reloads', async () => {
    await pending.approveMember(5, api, loadData);

    const [endpoint, options] = api.mock.calls[0];
    expect(endpoint).toBe('/admin/members/5');
    expect(options.method).toBe('PUT');
    expect(JSON.parse(options.body)).toEqual({ status: 'active', reason: 'Approved by admin' });
    expect(currentToast().textContent).toBe('Membre approuvé');
    expect(loadData).toHaveBeenCalledTimes(1);
  });

  it('shows the server error and does not reload on failure', async () => {
    api.mockRejectedValueOnce(new Error('Member not found'));
    await pending.approveMember(5, api, loadData);
    expect(currentToast().textContent).toBe('Member not found');
    expect(currentToast().classList.contains('error')).toBe(true);
    expect(loadData).not.toHaveBeenCalled();
  });
});

describe('rejectMember', () => {
  it('asks for confirmation first', () => {
    pending.rejectMember(5, api, loadData);
    expect(byId('confirm-message').textContent).toBe('Êtes-vous sûr de vouloir refuser cette demande ?');
    expect(byId('confirm-btn').className).toBe('btn btn-danger');
    expect(isHidden('confirm-modal')).toBe(false);
    expect(api).not.toHaveBeenCalled();
  });

  it('PUTs status rejected on confirm, then toasts, closes and reloads', async () => {
    pending.rejectMember(5, api, loadData);
    await confirm();

    const [endpoint, options] = api.mock.calls[0];
    expect(endpoint).toBe('/admin/members/5');
    expect(JSON.parse(options.body)).toEqual({ status: 'rejected', reason: 'Rejected by admin' });
    expect(currentToast().textContent).toBe('Demande refusée');
    expect(isHidden('confirm-modal')).toBe(true);
    expect(loadData).toHaveBeenCalledTimes(1);
  });

  it('keeps the modal open on failure', async () => {
    api.mockRejectedValueOnce(new Error('Failed to update member'));
    pending.rejectMember(5, api, loadData);
    await confirm();
    expect(currentToast().textContent).toBe('Failed to update member');
    expect(isHidden('confirm-modal')).toBe(false);
    expect(loadData).not.toHaveBeenCalled();
  });
});

describe('approveAll', () => {
  beforeEach(() => {
    state.members = [
      makeMember({ id: 1, status: 'pending' }), makeMember({ id: 2, status: 'active' }), makeMember({ id: 3, status: 'pending' })
    ];
  });

  it('does nothing without pending applications', async () => {
    state.members = [makeMember({ status: 'active' })];
    await pending.approveAll(api, loadData);
    expect(isHidden('confirm-modal')).toBe(true);
    expect(api).not.toHaveBeenCalled();
  });

  it('confirms the number of applications first', async () => {
    await pending.approveAll(api, loadData);
    expect(byId('confirm-message').textContent).toBe('Approuver 2 demande(s) ?');
    expect(byId('confirm-btn').className).toBe('btn btn-primary');
    expect(byId('confirm-btn').textContent).toBe('Approuver');
    expect(api).not.toHaveBeenCalled();
  });

  it('POSTs one batch with every pending id on confirm', async () => {
    await pending.approveAll(api, loadData);
    await confirm();

    const [endpoint, options] = api.mock.calls[0];
    expect(endpoint).toBe('/admin/members/batch');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual({ memberIds: [1, 3], status: 'active', reason: 'Batch approved by admin' });
    expect(currentToast().textContent).toBe('2 membre(s) approuvé(s)');
    expect(isHidden('confirm-modal')).toBe(true);
    expect(loadData).toHaveBeenCalledTimes(1);
  });

  it('keeps the modal open and reports the error on failure', async () => {
    api.mockRejectedValueOnce(new Error('Too many members (maximum 1000)'));
    await pending.approveAll(api, loadData);
    await confirm();
    expect(currentToast().textContent).toBe('Too many members (maximum 1000)');
    expect(isHidden('confirm-modal')).toBe(false);
    expect(loadData).not.toHaveBeenCalled();
  });
});
