/* global Event */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  mountAdminDom, byId, makeMember, XSS_ATTRIBUTE, XSS_APOSTROPHE,
  inlineHandlerAttributes, click, change, isolateDocumentListeners
} from './helpers.js';

isolateDocumentListeners();

let members;
let state;

beforeEach(async () => {
  vi.resetModules();
  mountAdminDom();
  state = (await import('../../src/client/admin/state.js')).state;
  members = await import('../../src/client/admin/features/members.js');
});

afterEach(() => vi.useRealTimers());

const container = () => byId('members-container');
const rowIds = () => [...container().querySelectorAll('tbody tr')].map((row) => Number(row.dataset.id));
const render = (list) => {
  state.members = list;
  members.renderMembers(list);
};

describe('renderMembers - markup contract', () => {
  it.each([
    ['active', 'Membre actif'], ['pending', 'En attente'], ['honor', "Membre d'honneur"],
    ['vice_president', 'Vice-président'], ['expired', 'Expiré']
  ])('labels the %s status with the shared French label (%s)', (status, label) => {
    render([makeMember({ id: 1, status })]);
    expect(container().querySelector('.badge').textContent).toBe(label);
  });

  it('renders one row per member with data-id', () => {
    render([makeMember({ id: 1 }), makeMember({ id: 2 })]);
    expect(container().querySelectorAll('tbody tr')).toHaveLength(2);
    expect(rowIds().sort()).toEqual([1, 2]);
  });

  it('wires actions through data attributes, with no inline handlers', () => {
    render([makeMember({ id: 7, status: 'pending' })]);

    expect(inlineHandlerAttributes(container())).toEqual([]);
    expect(container().querySelector('[data-action="edit-member"]').dataset.memberId).toBe('7');
    expect(container().querySelector('[data-action="confirm-delete-member"]').dataset.memberId).toBe('7');
    expect(container().querySelector('[data-action="approve-member"]').dataset.memberId).toBe('7');
    const checkbox = container().querySelector('tbody input[type="checkbox"]');
    expect(checkbox.dataset.change).toBe('toggle-member-select');
    expect(checkbox.dataset.memberId).toBe('7');
  });

  it('offers the approve button for pending members only', () => {
    render([makeMember({ id: 1, status: 'pending' }), makeMember({ id: 2, status: 'active' })]);
    const approve = [...container().querySelectorAll('[data-action="approve-member"]')];
    expect(approve.map((button) => button.dataset.memberId)).toEqual(['1']);
  });

  it('renders the select-all checkbox with its change action', () => {
    render([makeMember()]);
    const selectAll = byId('select-all');
    expect(selectAll.dataset.change).toBe('toggle-select-all');
    expect(selectAll.checked).toBe(false);
  });

  it('shows a placeholder, a zero badge and no table when nothing matches', () => {
    render([]);
    expect(container().textContent).toContain('Aucun membre trouvé');
    expect(container().querySelector('table')).toBeNull();
    expect(byId('members-badge').textContent).toBe('0');
    expect(byId('members-badge').classList.contains('hidden')).toBe(false);
  });

  it('updates the members tab badge with the filtered count', () => {
    render([makeMember(), makeMember(), makeMember()]);
    expect(byId('members-badge').textContent).toBe('3');
  });

  it('shows French status labels, including bureau roles', () => {
    render([makeMember({ status: 'secretary' }), makeMember({ status: 'honor' }), makeMember({ status: 'pending' })]);
    const labels = [...container().querySelectorAll('.badge')].map((badge) => badge.textContent);
    expect(labels.sort()).toEqual(["Membre d'honneur", 'En attente', 'Secrétaire'].sort());
  });

  it('renders the student number or a dash', () => {
    render([makeMember({ id: 1, student_id: 'S123' }), makeMember({ id: 2, student_id: null })]);
    const cells = [...container().querySelectorAll('tbody tr')].map((row) => row.children[3].textContent.trim());
    expect(cells.sort()).toEqual(['-', 'S123']);
  });
});

describe('renderMembers - escaping untrusted data', () => {
  const hostile = (payload) => makeMember({
    id: 1, first_name: payload, last_name: payload, email: `a${payload}@x.fr`, student_id: payload,
    enrollment_track: payload, phone: payload, telegram: payload, discord: payload, notes: payload, status: 'pending'
  });

  it.each([
    ['a quote/tag attribute breakout', XSS_ATTRIBUTE],
    ['apostrophes', XSS_APOSTROPHE],
    ['a script tag', '<script>alert(1)</script>'],
    ['an svg handler', '</td><svg onload=alert(1)>'],
    ['entities', '&lt;b&gt; &amp;']
  ])('does not create elements or handlers from %s in any field', (_label, payload) => {
    render([hostile(payload)]);

    expect(container().querySelector('img, script, svg')).toBeNull();
    expect(inlineHandlerAttributes(container())).toEqual([]);
    expect(container().querySelectorAll('tbody tr')).toHaveLength(1);
    expect(container().querySelectorAll('tbody tr > td')).toHaveLength(9);
  });

  it('shows hostile names as literal text', () => {
    render([makeMember({ first_name: XSS_ATTRIBUTE, last_name: XSS_APOSTROPHE })]);
    expect(container().querySelector('tbody strong').textContent).toBe(`${XSS_ATTRIBUTE} ${XSS_APOSTROPHE}`);
  });

  it('keeps the email inside the mailto href attribute verbatim', () => {
    render([makeMember({ email: `${XSS_ATTRIBUTE}@x.fr` })]);
    const link = container().querySelector('a[href^="mailto:"]');
    expect(link.getAttribute('href')).toBe(`mailto:${XSS_ATTRIBUTE}@x.fr`);
    expect(link.attributes).toHaveLength(1);
  });

  it('cannot break out of the href with an apostrophe', () => {
    render([makeMember({ email: "x' onclick='alert(1)@y.fr" })]);
    const link = container().querySelector('a');
    expect(link.attributes).toHaveLength(1);
    expect(link.hasAttribute('onclick')).toBe(false);
  });

  it('escapes the status badge even for a status the client does not know', () => {
    render([makeMember({ status: '<img src=x onerror=alert(1)>' })]);
    expect(container().querySelector('img')).toBeNull();
    expect(container().querySelector('.badge').textContent).toBe('<img src=x onerror=alert(1)>');
  });

  it('escapes the notes preview', () => {
    render([makeMember({ notes: XSS_ATTRIBUTE })]);
    expect(container().querySelector('small').textContent).toBe(XSS_ATTRIBUTE);
  });
});

describe('renderMembers - notes preview', () => {
  it.each([
    [10, 'a'.repeat(10)],
    [50, 'a'.repeat(50)],
    [51, `${'a'.repeat(50)}...`],
    [120, `${'a'.repeat(50)}...`]
  ])('truncates a %i character note to the preview', (length, expected) => {
    render([makeMember({ notes: 'a'.repeat(length) })]);
    expect(container().querySelector('small').textContent).toBe(expected);
  });

  it('renders no preview without notes', () => {
    render([makeMember({ notes: null })]);
    expect(container().querySelector('small')).toBeNull();
  });
});

describe('sorting', () => {
  const people = () => [
    makeMember({ id: 1, last_name: 'Charlie', email: 'c@x.fr', created_at: '2025-01-01 10:00:00', student_id: null }),
    makeMember({ id: 2, last_name: 'alpha', email: 'b@x.fr', created_at: '2025-03-01 10:00:00', student_id: 'S2' }),
    makeMember({ id: 3, last_name: 'Bravo', email: 'a@x.fr', created_at: '2025-02-01 10:00:00', student_id: 'S1' })
  ];

  it('defaults to newest registration first and marks that header', () => {
    render(people());
    expect(rowIds()).toEqual([2, 3, 1]);
    const marked = container().querySelectorAll('th.sortable[data-sort]');
    expect(marked).toHaveLength(1);
    expect(marked[0].dataset.field).toBe('created_at');
    expect(marked[0].dataset.sort).toBe('desc');
  });

  it('renders the six sortable headers with the sort-members action', () => {
    render(people());
    const headers = [...container().querySelectorAll('th.sortable')];
    expect(headers.map((th) => th.dataset.field)).toEqual([
      'last_name', 'email', 'student_id', 'enrollment_track', 'status', 'created_at'
    ]);
    expect(headers.every((th) => th.dataset.action === 'sort-members')).toBe(true);
    expect(headers.every((th) => th.querySelector('.sort-indicator'))).toBe(true);
  });

  it('keeps the column classes on sortable headers', () => {
    render(people());
    expect(container().querySelector('th[data-field="enrollment_track"]').classList.contains('team-col')).toBe(true);
    expect(container().querySelector('th[data-field="status"]').classList.contains('badge-col')).toBe(true);
  });

  it('toggleSort on a new field sorts ascending, case-insensitively', () => {
    render(people());
    members.toggleSort('last_name');
    expect(rowIds()).toEqual([2, 3, 1]);
    expect(container().querySelector('th[data-field="last_name"]').dataset.sort).toBe('asc');
    expect(container().querySelectorAll('th[data-sort]')).toHaveLength(1);
  });

  it('toggleSort on the active field flips the direction', () => {
    render(people());
    members.toggleSort('email');
    expect(rowIds()).toEqual([3, 2, 1]);
    members.toggleSort('email');
    expect(rowIds()).toEqual([1, 2, 3]);
    expect(container().querySelector('th[data-field="email"]').dataset.sort).toBe('desc');
  });

  it('sorts missing values as empty strings (first when ascending)', () => {
    render(people());
    members.toggleSort('student_id');
    expect(rowIds()[0]).toBe(1);
  });

  it('does not reorder the stored members array', () => {
    const list = people();
    render(list);
    members.toggleSort('email');
    expect(list.map((m) => m.id)).toEqual([1, 2, 3]);
  });

  it('is driven by clicking a header through the delegated action contract', async () => {
    const { buildActions } = await import('../../src/client/admin/actions.js');
    const { bindDelegation } = await import('@info-evry/astro-design/scripts/delegation');
    const { actions, changes } = buildActions({ api: vi.fn(), loadData: vi.fn() });
    bindDelegation(actions, changes);

    render(people());
    click(container().querySelector('th[data-field="email"]'));

    expect(rowIds()).toEqual([3, 2, 1]);
  });
});

describe('filtering', () => {
  const roster = () => [
    makeMember({ id: 1, status: 'active', enrollment_track: 'L3 Informatique', first_name: 'Ada', last_name: 'Lovelace', email: 'ada@x.fr' }),
    makeMember({ id: 2, status: 'pending', enrollment_track: 'M1 Informatique', first_name: 'Bob', last_name: 'Stone', notes: 'Cherche un stage' }),
    makeMember({ id: 3, status: 'president', enrollment_track: 'L3 Informatique', first_name: 'Cy', last_name: 'Prez', telegram: '@cyprez' }),
    makeMember({ id: 4, status: 'honorary_president', enrollment_track: 'Autre', first_name: 'Di', last_name: 'Honor' }),
    makeMember({ id: 5, status: 'rejected', enrollment_track: 'Autre', first_name: 'Ed', last_name: 'Nope', student_id: 'ZX-99' })
  ];
  const filterBy = (id, value) => {
    byId(id).value = value;
    members.renderMembers(state.members);
  };

  beforeEach(() => {
    state.members = roster();
    members.renderMembers(state.members);
  });

  it('shows everyone without filters', () => {
    expect(rowIds().sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('filters by an exact status', () => {
    filterBy('filter-status', 'pending');
    expect(rowIds()).toEqual([2]);
  });

  it('groups every bureau role (including honorary president) under "bureau"', () => {
    filterBy('filter-status', 'bureau');
    expect(rowIds().sort()).toEqual([3, 4]);
  });

  it('filters by track', () => {
    members.populateTrackFilter(state.members);
    filterBy('filter-track', 'L3 Informatique');
    expect(rowIds().sort()).toEqual([1, 3]);
  });

  it.each([
    ['name', 'LOVELACE', [1]],
    ['first name with padding', '  ada ', [1]],
    ['email', 'ada@x', [1]],
    ['notes', 'stage', [2]],
    ['telegram', '@cyprez', [3]],
    ['student id', 'zx-99', [5]],
    ['track', 'm1', [2]],
    ['nothing', 'no-such-person', []]
  ])('searches %s case-insensitively', (_label, query, expected) => {
    filterBy('filter-search', query);
    expect(rowIds().sort()).toEqual(expected);
  });

  it('combines status, track and search with AND semantics', () => {
    members.populateTrackFilter(state.members);
    byId('filter-status').value = 'active';
    byId('filter-track').value = 'L3 Informatique';
    filterBy('filter-search', 'ada');
    expect(rowIds()).toEqual([1]);

    filterBy('filter-search', 'bob');
    expect(rowIds()).toEqual([]);
    expect(container().textContent).toContain('Aucun membre trouvé');
  });

  it('treats search text as plain text, not a pattern', () => {
    filterBy('filter-search', '.*');
    expect(rowIds()).toEqual([]);
  });

  it('does not match on null fields', () => {
    filterBy('filter-search', 'null');
    expect(rowIds()).toEqual([]);
  });

  it('updates the badge with the filtered count', () => {
    filterBy('filter-status', 'bureau');
    expect(byId('members-badge').textContent).toBe('2');
  });
});

describe('populateTrackFilter', () => {
  it('lists unique tracks alphabetically after the default option', () => {
    members.populateTrackFilter([
      makeMember({ enrollment_track: 'M1' }), makeMember({ enrollment_track: 'L3' }), makeMember({ enrollment_track: 'M1' })
    ]);
    const options = [...byId('filter-track').options].map((option) => [option.value, option.textContent]);
    expect(options).toEqual([['', 'Tous les cursus'], ['L3', 'L3'], ['M1', 'M1']]);
  });

  it('escapes tracks so they cannot inject options or attributes', () => {
    members.populateTrackFilter([makeMember({ enrollment_track: XSS_ATTRIBUTE }), makeMember({ enrollment_track: XSS_APOSTROPHE })]);
    const select = byId('filter-track');
    expect(select.querySelector('img')).toBeNull();
    expect(select.options).toHaveLength(3);
    expect([...select.options].map((option) => option.value)).toContain(XSS_ATTRIBUTE);
    expect([...select.options].map((option) => option.value)).toContain(XSS_APOSTROPHE);
  });

  it('resets to just the default option for an empty roster', () => {
    members.populateTrackFilter([]);
    expect(byId('filter-track').options).toHaveLength(1);
  });
});

describe('selection', () => {
  const roster = () => [makeMember({ id: 1 }), makeMember({ id: 2 }), makeMember({ id: 3 })];

  beforeEach(() => render(roster()));

  it('starts with the bulk bar hidden', () => {
    expect(byId('bulk-actions').classList.contains('hidden')).toBe(true);
    expect(byId('selection-count').textContent).toBe('0 sélectionné(s)');
  });

  it('selecting a member shows the bulk bar, the count and highlights the row', () => {
    members.toggleMemberSelection(2, true);

    expect(state.selectedMembers).toEqual(new Set([2]));
    expect(byId('bulk-actions').classList.contains('hidden')).toBe(false);
    expect(byId('selection-count').textContent).toBe('1 sélectionné(s)');
    expect(container().querySelector('tr[data-id="2"]').classList.contains('selected')).toBe(true);
    expect(container().querySelector('tr[data-id="1"]').classList.contains('selected')).toBe(false);
  });

  it('deselecting the last member hides the bulk bar again', () => {
    members.toggleMemberSelection(2, true);
    members.toggleMemberSelection(2, false);
    expect(state.selectedMembers.size).toBe(0);
    expect(byId('bulk-actions').classList.contains('hidden')).toBe(true);
    expect(container().querySelector('tr[data-id="2"]').classList.contains('selected')).toBe(false);
  });

  it('keeps the select-all checkbox in sync with the row selection', () => {
    for (const id of [1, 2, 3]) members.toggleMemberSelection(id, true);
    expect(byId('select-all').checked).toBe(true);
    members.toggleMemberSelection(3, false);
    expect(byId('select-all').checked).toBe(false);
  });

  it('select-all selects every visible member and re-renders checked boxes', () => {
    members.toggleSelectAll(true);
    expect(state.selectedMembers).toEqual(new Set([1, 2, 3]));
    expect(byId('selection-count').textContent).toBe('3 sélectionné(s)');
    const boxes = [...container().querySelectorAll('tbody input[type="checkbox"]')];
    expect(boxes.every((box) => box.checked)).toBe(true);
    expect(byId('select-all').checked).toBe(true);
    expect(container().querySelectorAll('tr.selected')).toHaveLength(3);
  });

  it('select-all only selects members that pass the current filters', () => {
    state.members = [
      makeMember({ id: 1, status: 'active' }), makeMember({ id: 2, status: 'pending' }), makeMember({ id: 3, status: 'pending' })
    ];
    byId('filter-status').value = 'pending';
    members.renderMembers(state.members);

    members.toggleSelectAll(true);

    expect(state.selectedMembers).toEqual(new Set([2, 3]));
  });

  it('unchecking select-all clears the selection', () => {
    members.toggleSelectAll(true);
    members.toggleSelectAll(false);
    expect(state.selectedMembers.size).toBe(0);
    expect(byId('bulk-actions').classList.contains('hidden')).toBe(true);
  });

  it('drops selected members that a filter hides', () => {
    state.members = [makeMember({ id: 1, status: 'active' }), makeMember({ id: 2, status: 'pending' })];
    members.renderMembers(state.members);
    members.toggleMemberSelection(1, true);
    members.toggleMemberSelection(2, true);

    byId('filter-status').value = 'pending';
    members.renderMembers(state.members);

    expect(state.selectedMembers).toEqual(new Set([2]));
    expect(byId('selection-count').textContent).toBe('1 sélectionné(s)');
  });

  it('drops selected members that no longer exist after a reload', () => {
    members.toggleMemberSelection(1, true);
    members.renderMembers([makeMember({ id: 2 })]);
    expect(state.selectedMembers.size).toBe(0);
  });

  it('restores checked state for selected rows on re-render', () => {
    members.toggleMemberSelection(2, true);
    members.renderMembers(state.members);
    expect(container().querySelector('tr[data-id="2"] input').checked).toBe(true);
    expect(container().querySelector('tr[data-id="1"] input').checked).toBe(false);
  });
});

describe('initMembers', () => {
  const api = vi.fn();
  const loadData = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    state.members = [
      makeMember({ id: 1, first_name: 'Ada', status: 'active' }),
      makeMember({ id: 2, first_name: 'Bob', status: 'pending' })
    ];
    members.initMembers(api, loadData);
    members.renderMembers(state.members);
  });

  it('re-renders when the status filter changes', () => {
    byId('filter-status').value = 'pending';
    change(byId('filter-status'));
    expect(rowIds()).toEqual([2]);
  });

  it('re-renders when the track filter changes', () => {
    members.populateTrackFilter(state.members);
    byId('filter-track').value = 'L3 Informatique';
    change(byId('filter-track'));
    expect(rowIds().sort()).toEqual([1, 2]);
  });

  it('debounces the search box by 300 ms', () => {
    byId('filter-search').value = 'ada';
    byId('filter-search').dispatchEvent(new Event('input', { bubbles: true }));

    vi.advanceTimersByTime(299);
    expect(rowIds().sort()).toEqual([1, 2]);

    vi.advanceTimersByTime(1);
    expect(rowIds()).toEqual([1]);
  });

  it('only searches once for a burst of keystrokes', () => {
    const input = byId('filter-search');
    for (const text of ['a', 'ad', 'ada']) {
      input.value = text;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      vi.advanceTimersByTime(100);
    }
    expect(rowIds().sort()).toEqual([1, 2]);
    vi.advanceTimersByTime(300);
    expect(rowIds()).toEqual([1]);
  });
});
