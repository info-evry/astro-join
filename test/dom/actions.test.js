/* global document */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { bindDelegation } from '@info-evry/astro-design/scripts/delegation';
import { buildActions } from '../../src/client/admin/actions.js';
import { isolateDocumentListeners, click, change, settle } from './helpers.js';

// Delegation itself is astro-design's (tested there); these tests cover the glue:
// the data-action / data-change names of this dashboard and how their dataset ids are read.

isolateDocumentListeners();

const api = vi.fn();
const loadData = vi.fn();
let actions;
let changes;
let unbind;

beforeEach(() => {
  api.mockReset();
  loadData.mockReset();
  ({ actions, changes } = buildActions({ api, loadData }));
  // astro-design binds once per root: unbind so every test starts from a fresh listener
  unbind = bindDelegation(actions, changes);
});

afterEach(() => unbind());

describe('buildActions', () => {
  it('registers every dashboard action and change handler as own keys', () => {
    expect(Object.keys(actions).sort()).toEqual([
      'approve-all', 'approve-member', 'bulk-approve', 'bulk-delete', 'bulk-set-status',
      'confirm-delete-member', 'edit-member', 'reject-member', 'sort-members'
    ]);
    expect(Object.keys(changes).sort()).toEqual(['toggle-member-select', 'toggle-select-all']);
  });

  it.each(['constructor', '__proto__', 'toString'])('has no inherited handler for %s', (name) => {
    expect(Object.hasOwn(actions, name)).toBe(false);
    expect(Object.hasOwn(changes, name)).toBe(false);
  });
});

describe('click delegation through astro-design', () => {
  it('reads the member id of a data-member-id element as a number', async () => {
    document.body.innerHTML = '<button id="b" data-action="approve-member" data-member-id="4">Approuver</button>';

    click(document.getElementById('b'));
    await settle();

    expect(api).toHaveBeenCalledWith('/admin/members/4', expect.objectContaining({ method: 'PUT' }));
  });

  it.each(['', 'abc', undefined])('ignores an action element whose member id is %j', async (id) => {
    const attribute = id === undefined ? '' : ` data-member-id="${id}"`;
    document.body.innerHTML = `<button id="b" data-action="approve-member"${attribute}>Approuver</button>`;

    click(document.getElementById('b'));
    await settle();

    expect(api).not.toHaveBeenCalled();
  });

  it('prevents the default of handled button clicks and ignores unknown actions', () => {
    document.body.innerHTML = '<button id="a" data-action="sort-members" data-field="email"></button><button id="b" data-action="nope"></button>';
    expect(click(document.getElementById('a')).defaultPrevented).toBe(true);
    expect(click(document.getElementById('b')).defaultPrevented).toBe(false);
  });

  it.each(['constructor', '__proto__', 'hasOwnProperty'])('does not treat inherited "%s" as an action', (name) => {
    document.body.innerHTML = `<button id="b" data-action="${name}">x</button>`;
    expect(click(document.getElementById('b')).defaultPrevented).toBe(false);
  });
});

describe('change delegation through astro-design', () => {
  it('ignores a selection checkbox without a usable member id', () => {
    document.body.innerHTML = '<input id="c" type="checkbox" data-change="toggle-member-select" data-member-id="x">';
    expect(() => change(document.getElementById('c'))).not.toThrow();
  });

  it.each(['constructor', '__proto__', 'toString'])('does not treat inherited "%s" as a change handler', (name) => {
    document.body.innerHTML = `<input id="c" data-change="${name}">`;
    expect(() => change(document.getElementById('c'))).not.toThrow();
  });
});
