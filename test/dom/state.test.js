import { describe, it, expect, beforeEach, vi } from 'vitest';

let stateModule;
beforeEach(async () => {
  vi.resetModules();
  stateModule = await import('../../src/client/admin/state.js');
});

describe('admin state', () => {
  it('starts empty, sorted by newest registration first', () => {
    const { state } = stateModule;
    expect(state.members).toEqual([]);
    expect(state.stats).toBeNull();
    expect(state.selectedMembers.size).toBe(0);
    expect(state.sortField).toBe('created_at');
    expect(state.sortDirection).toBe('desc');
    expect(state.importData).toBeNull();
  });

  it('setMembersData replaces members and stats together', () => {
    const { state, setMembersData } = stateModule;
    const members = [{ id: 1 }];
    setMembersData(members, { total: 1 });
    expect(state.members).toBe(members);
    expect(state.stats).toEqual({ total: 1 });
  });

  it('no longer keeps its own copy of the status labels or bureau roles (they are shared with the API)', () => {
    expect(stateModule).not.toHaveProperty('STATUS_LABELS');
    expect(stateModule).not.toHaveProperty('BUREAU_STATUSES');
  });
});
