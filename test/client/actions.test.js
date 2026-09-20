import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/client/admin/features/members.js', () => ({
  toggleSort: vi.fn(),
  toggleSelectAll: vi.fn(),
  toggleMemberSelection: vi.fn()
}));

vi.mock('../../src/client/admin/features/member-actions.js', () => ({
  editMember: vi.fn(),
  confirmDeleteMember: vi.fn(),
  bulkApprove: vi.fn(),
  bulkSetStatus: vi.fn(),
  bulkDelete: vi.fn()
}));

vi.mock('../../src/client/admin/features/pending.js', () => ({
  approveMember: vi.fn(),
  rejectMember: vi.fn(),
  approveAll: vi.fn()
}));

const { buildActions } = await import('../../src/client/admin/actions.js');
const { toggleSort, toggleSelectAll, toggleMemberSelection } = await import('../../src/client/admin/features/members.js');
const { editMember, confirmDeleteMember, bulkApprove, bulkSetStatus, bulkDelete } = await import('../../src/client/admin/features/member-actions.js');
const { approveMember, rejectMember, approveAll } = await import('../../src/client/admin/features/pending.js');

describe('buildActions', () => {
  let api;
  let loadData;
  let actions;
  let changes;

  beforeEach(() => {
    vi.clearAllMocks();
    api = vi.fn();
    loadData = vi.fn();
    ({ actions, changes } = buildActions({ api, loadData }));
  });

  it('reads numeric member id for edit-member', () => {
    actions['edit-member']({ dataset: { memberId: '5' } });
    expect(editMember).toHaveBeenCalledWith(5);
  });

  it('reads numeric member id for confirm-delete-member', () => {
    actions['confirm-delete-member']({ dataset: { memberId: '7' } });
    expect(confirmDeleteMember).toHaveBeenCalledWith(7, api, loadData);
  });

  it('reads numeric member id for approve-member / reject-member', () => {
    actions['approve-member']({ dataset: { memberId: '3' } });
    expect(approveMember).toHaveBeenCalledWith(3, api, loadData);

    actions['reject-member']({ dataset: { memberId: '9' } });
    expect(rejectMember).toHaveBeenCalledWith(9, api, loadData);
  });

  it('reads the field for sort-members', () => {
    actions['sort-members']({ dataset: { field: 'email' } });
    expect(toggleSort).toHaveBeenCalledWith('email');
  });

  it('calls approveAll with api and loadData for approve-all', () => {
    actions['approve-all']();
    expect(approveAll).toHaveBeenCalledWith(api, loadData);
  });

  it('calls bulkApprove for bulk-approve', () => {
    actions['bulk-approve']();
    expect(bulkApprove).toHaveBeenCalledWith(api, loadData);
  });

  it('reads status for bulk-set-status', () => {
    actions['bulk-set-status']({ dataset: { status: 'active' } });
    expect(bulkSetStatus).toHaveBeenCalledWith('active', api, loadData);
  });

  it('calls bulkDelete for bulk-delete', () => {
    actions['bulk-delete']();
    expect(bulkDelete).toHaveBeenCalledWith(api, loadData);
  });

  it('toggle-select-all change handler forwards checked state', () => {
    changes['toggle-select-all']({ checked: true });
    expect(toggleSelectAll).toHaveBeenCalledWith(true);
  });

  it('toggle-member-select change handler forwards member id and checked state', () => {
    changes['toggle-member-select']({ dataset: { memberId: '11' }, checked: false });
    expect(toggleMemberSelection).toHaveBeenCalledWith(11, false);
  });
});
