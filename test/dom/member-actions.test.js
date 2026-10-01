/* global document, Event, HTMLAnchorElement */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  mountAdminDom, byId, makeMember, csvResponse, settle, currentToast, isHidden, click
} from './helpers.js';

let actions;
let state;
let api;
let loadData;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  mountAdminDom();
  state = (await import('../../src/client/admin/state.js')).state;
  actions = await import('../../src/client/admin/features/member-actions.js');
  api = vi.fn().mockResolvedValue({ success: true });
  loadData = vi.fn();
  state.members = [
    makeMember({ id: 1, first_name: 'Ada', last_name: 'Lovelace', status: 'pending', student_id: 'S1', notes: 'hello' }),
    makeMember({ id: 2, first_name: '<b>Bob</b>', last_name: 'Stone', status: 'active' }),
    makeMember({ id: 3, status: 'active' })
  ];
});

afterEach(() => vi.useRealTimers());

/** Click the confirm button the way a user would (astro-design's confirmAction owns the listener). */
const confirm = async () => {
  click(byId('confirm-btn'));
  await settle();
};
const toastText = () => currentToast()?.textContent;

describe('editMember', () => {
  it('fills the form from the member and opens the modal', () => {
    actions.editMember(1);

    expect(byId('member-form-id').value).toBe('1');
    expect(byId('member-form-firstname').value).toBe('Ada');
    expect(byId('member-form-lastname').value).toBe('Lovelace');
    expect(byId('member-form-email').value).toBe('member1@test.example');
    expect(byId('member-form-studentid').value).toBe('S1');
    expect(byId('member-form-track').value).toBe('L3 Informatique');
    expect(byId('member-form-status').value).toBe('pending');
    expect(byId('member-form-notes').value).toBe('hello');
    expect(isHidden('member-modal')).toBe(false);
  });

  it('uses empty strings for null student id and notes', () => {
    actions.editMember(3);
    expect(byId('member-form-studentid').value).toBe('');
    expect(byId('member-form-notes').value).toBe('');
  });

  it('does nothing for an unknown member', () => {
    actions.editMember(999);
    expect(isHidden('member-modal')).toBe(true);
    expect(byId('member-form-id').value).toBe('');
  });
});

describe('handleMemberSubmit', () => {
  const submit = async () => {
    const event = new Event('submit', { cancelable: true });
    await actions.handleMemberSubmit(event, api, loadData);
    return event;
  };

  beforeEach(() => {
    actions.editMember(1);
    byId('member-form-firstname').value = 'Changed';
    byId('member-form-status').value = 'active';
  });

  it('prevents the native submit and PUTs the full form to the member endpoint', async () => {
    const event = await submit();

    expect(event.defaultPrevented).toBe(true);
    expect(api).toHaveBeenCalledTimes(1);
    const [endpoint, options] = api.mock.calls[0];
    expect(endpoint).toBe('/admin/members/1');
    expect(options.method).toBe('PUT');
    expect(JSON.parse(options.body)).toEqual({
      firstName: 'Changed', lastName: 'Lovelace', email: 'member1@test.example', studentId: 'S1',
      enrollmentTrack: 'L3 Informatique', status: 'active', notes: 'hello'
    });
  });

  it('on success: toasts, closes the modal and reloads', async () => {
    await submit();
    expect(toastText()).toBe('Membre mis à jour');
    expect(currentToast().classList.contains('success')).toBe(true);
    expect(isHidden('member-modal')).toBe(true);
    expect(loadData).toHaveBeenCalledTimes(1);
  });

  it('on failure: shows the error, keeps the modal open and does not reload', async () => {
    api.mockRejectedValueOnce(new Error('Email already used by another member'));
    await submit();
    expect(toastText()).toBe('Email already used by another member');
    expect(currentToast().classList.contains('error')).toBe(true);
    expect(isHidden('member-modal')).toBe(false);
    expect(loadData).not.toHaveBeenCalled();
  });
});

describe('confirmDeleteMember', () => {
  it('asks for confirmation naming the member, without opening the API yet', () => {
    actions.confirmDeleteMember(1, api, loadData);
    expect(byId('confirm-message').textContent).toBe('Êtes-vous sûr de vouloir supprimer Ada Lovelace ?');
    expect(byId('confirm-btn').className).toBe('btn btn-danger');
    expect(isHidden('confirm-modal')).toBe(false);
    expect(api).not.toHaveBeenCalled();
  });

  it('renders the member name as text, never as markup', () => {
    actions.confirmDeleteMember(2, api, loadData);
    expect(byId('confirm-message').querySelector('b')).toBeNull();
    expect(byId('confirm-message').textContent).toContain('<b>Bob</b> Stone');
  });

  it('deletes on confirm, then toasts, closes the modal and reloads', async () => {
    actions.confirmDeleteMember(1, api, loadData);
    await confirm();

    expect(api).toHaveBeenCalledWith('/admin/members/1', { method: 'DELETE' });
    expect(toastText()).toBe('Membre supprimé');
    expect(isHidden('confirm-modal')).toBe(true);
    expect(loadData).toHaveBeenCalledTimes(1);
  });

  it('keeps the modal open and shows the error when the delete fails', async () => {
    api.mockRejectedValueOnce(new Error('Member not found'));
    actions.confirmDeleteMember(1, api, loadData);
    await confirm();

    expect(toastText()).toBe('Member not found');
    expect(isHidden('confirm-modal')).toBe(false);
    expect(loadData).not.toHaveBeenCalled();
  });

  it('the confirm button always acts on the most recently requested member', async () => {
    actions.confirmDeleteMember(1, api, loadData);
    actions.confirmDeleteMember(3, api, loadData);
    await confirm();
    expect(api).toHaveBeenCalledTimes(1);
    expect(api).toHaveBeenCalledWith('/admin/members/3', { method: 'DELETE' });
  });
});

describe('bulk actions', () => {
  const select = (...ids) => {
    state.selectedMembers = new Set(ids);
  };

  describe.each([
    ['bulkApprove', () => actions.bulkApprove(api, loadData)],
    ['bulkSetStatus', () => actions.bulkSetStatus('expired', api, loadData)],
    ['bulkDelete', () => actions.bulkDelete(api, loadData)]
  ])('%s', (_name, run) => {
    it('does nothing when no member is selected', () => {
      select();
      run();
      expect(isHidden('confirm-modal')).toBe(true);
      expect(byId('confirm-message').textContent).toBe('');
      expect(api).not.toHaveBeenCalled();
    });
  });

  it('bulkApprove confirms the count, then POSTs the batch with status active', async () => {
    select(1, 3);
    actions.bulkApprove(api, loadData);

    expect(byId('confirm-message').textContent).toBe('Approuver 2 membre(s) sélectionné(s) ?');
    expect(byId('confirm-btn').textContent).toBe('Approuver');
    expect(isHidden('confirm-modal')).toBe(false);
    expect(api).not.toHaveBeenCalled();

    await confirm();

    const [endpoint, options] = api.mock.calls[0];
    expect(endpoint).toBe('/admin/members/batch');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual({ memberIds: [1, 3], status: 'active', reason: 'Bulk approved by admin' });
    expect(toastText()).toBe('2 membre(s) approuvé(s)');
    expect(state.selectedMembers.size).toBe(0);
    expect(isHidden('confirm-modal')).toBe(true);
    expect(loadData).toHaveBeenCalledTimes(1);
  });

  it('bulkApprove keeps the selection and modal when the request fails', async () => {
    api.mockRejectedValueOnce(new Error('No matching members found'));
    select(1);
    actions.bulkApprove(api, loadData);
    await confirm();

    expect(toastText()).toBe('No matching members found');
    expect(state.selectedMembers).toEqual(new Set([1]));
    expect(isHidden('confirm-modal')).toBe(false);
    expect(loadData).not.toHaveBeenCalled();
  });

  it.each([
    ['honor', "Membre d'honneur"],
    ['expired', 'Expiré'],
    ['active', 'Membre actif']
  ])('bulkSetStatus(%s) names the status in French', async (status, label) => {
    select(2);
    actions.bulkSetStatus(status, api, loadData);
    expect(byId('confirm-message').textContent).toBe(`Définir 1 membre(s) comme "${label}" ?`);

    await confirm();

    expect(JSON.parse(api.mock.calls[0][1].body)).toEqual({
      memberIds: [2], status, reason: `Bulk status change to ${status} by admin`
    });
    expect(toastText()).toBe('1 membre(s) mis à jour');
  });

  it('bulkSetStatus falls back to the raw status for an unknown label', () => {
    select(2);
    actions.bulkSetStatus('mystery', api, loadData);
    expect(byId('confirm-message').textContent).toContain('"mystery"');
  });

  it('bulkDelete warns it is irreversible with a danger button, in plain text', () => {
    select(1, 2);
    actions.bulkDelete(api, loadData);
    expect(byId('confirm-message').textContent).toContain('Supprimer définitivement 2 membre(s) ?');
    expect(byId('confirm-message').textContent).toContain('irréversible');
    expect(byId('confirm-message').children).toHaveLength(0);
    expect(byId('confirm-btn').className).toBe('btn btn-danger');
    expect(byId('confirm-btn').textContent).toBe('Supprimer');
  });

  it('bulkDelete sends ONE DELETE /admin/members/batch for the whole selection, then reloads', async () => {
    api.mockResolvedValue({ success: true, deleted: 3 });
    select(1, 2, 3);
    actions.bulkDelete(api, loadData);
    await confirm();

    expect(api).toHaveBeenCalledTimes(1);
    const [endpoint, options] = api.mock.calls[0];
    expect(endpoint).toBe('/admin/members/batch');
    expect(options.method).toBe('DELETE');
    expect(JSON.parse(options.body)).toEqual({ ids: [1, 2, 3] });
    expect(toastText()).toBe('3 membre(s) supprimé(s)');
    expect(state.selectedMembers.size).toBe(0);
    expect(isHidden('confirm-modal')).toBe(true);
    expect(loadData).toHaveBeenCalledTimes(1);
  });

  it('bulkDelete reports the count the server really deleted', async () => {
    api.mockResolvedValue({ success: true, deleted: 2 });
    select(1, 2, 3);
    actions.bulkDelete(api, loadData);
    await confirm();
    expect(toastText()).toBe('2 membre(s) supprimé(s)');
  });

  it('bulkDelete splits a selection above the server cap (1000 ids) into several requests', async () => {
    api.mockImplementation(async (_endpoint, options) => ({ success: true, deleted: JSON.parse(options.body).ids.length }));
    select(...Array.from({ length: 2500 }, (_, i) => i + 1));
    actions.bulkDelete(api, loadData);
    await confirm();

    expect(api.mock.calls.map(([, options]) => JSON.parse(options.body).ids.length)).toEqual([1000, 1000, 500]);
    expect(toastText()).toBe('2500 membre(s) supprimé(s)');
  });

  it('bulkDelete keeps the selection and the modal open when the request fails', async () => {
    api.mockRejectedValueOnce(new Error('Trop de membres (maximum 1000)'));
    select(1, 2);
    actions.bulkDelete(api, loadData);
    await confirm();

    expect(toastText()).toBe('Trop de membres (maximum 1000)');
    expect(state.selectedMembers).toEqual(new Set([1, 2]));
    expect(isHidden('confirm-modal')).toBe(false);
    expect(loadData).not.toHaveBeenCalled();
  });

  it('bulkSetStatus also splits a selection above the cap', async () => {
    select(...Array.from({ length: 1001 }, (_, i) => i + 1));
    actions.bulkSetStatus('expired', api, loadData);
    await confirm();
    expect(api.mock.calls.map(([, options]) => JSON.parse(options.body).memberIds.length)).toEqual([1000, 1]);
  });
});

describe('handleExport', () => {
  let anchorClick;

  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:csv');
    URL.revokeObjectURL = vi.fn();
    anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function recordDownload() {
      anchorClick.downloaded = { href: this.getAttribute('href'), name: this.download };
    });
    api.mockResolvedValue(csvResponse('ID,Prénom\n'));
  });

  it('downloads members.csv for all statuses', async () => {
    byId('filter-status').value = '';
    await actions.handleExport(api);

    expect(api).toHaveBeenCalledWith('/admin/export');
    expect(anchorClick.downloaded).toEqual({ href: 'blob:csv', name: 'members.csv' });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:csv');
    expect(document.querySelector('a[download]')).toBeNull();
  });

  it('exports and names the file after the selected status filter', async () => {
    byId('filter-status').value = 'pending';
    await actions.handleExport(api);

    expect(api).toHaveBeenCalledWith('/admin/export?status=pending');
    expect(anchorClick.downloaded.name).toBe('members_pending.csv');
  });

  it('toasts the error and downloads nothing when the export fails', async () => {
    api.mockRejectedValueOnce(new Error('Failed to export members'));
    await actions.handleExport(api);

    expect(toastText()).toBe('Failed to export members');
    expect(anchorClick).not.toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});
