/**
 * Admin action/change delegation
 *
 * Builds the lookup maps consumed by the delegated `click`/`change`
 * listeners and wires those listeners up, replacing inline onclick/onchange
 * handlers and the `window.adminDashboard` global with data-action /
 * data-change attributes read from the clicked/changed element's dataset.
 */
/* eslint-env browser */

import { toggleSort, toggleSelectAll, toggleMemberSelection } from './features/members.js';
import { editMember, confirmDeleteMember, bulkApprove, bulkSetStatus, bulkDelete } from './features/member-actions.js';
import { approveMember, rejectMember, approveAll } from './features/pending.js';

/**
 * Build the click-action ("actions") and change-action ("changes") lookup
 * maps used by the delegated document listeners.
 * @param {Object} deps
 * @param {Function} deps.api - API client function
 * @param {Function} deps.loadData - Reload callback
 * @returns {{actions: Object<string, Function>, changes: Object<string, Function>}}
 */
export function buildActions({ api, loadData }) {
  const actions = {
    'edit-member': (el) => editMember(Number(el.dataset.memberId)),
    'confirm-delete-member': (el) => confirmDeleteMember(Number(el.dataset.memberId), api, loadData),
    'approve-member': (el) => approveMember(Number(el.dataset.memberId), api, loadData),
    'reject-member': (el) => rejectMember(Number(el.dataset.memberId), api, loadData),
    'sort-members': (el) => toggleSort(el.dataset.field),
    'approve-all': () => approveAll(api, loadData),
    'bulk-approve': () => bulkApprove(api, loadData),
    'bulk-set-status': (el) => bulkSetStatus(el.dataset.status, api, loadData),
    'bulk-delete': () => bulkDelete(api, loadData)
  };

  const changes = {
    'toggle-select-all': (el) => toggleSelectAll(el.checked),
    'toggle-member-select': (el) => toggleMemberSelection(Number(el.dataset.memberId), el.checked)
  };

  return { actions, changes };
}

/**
 * Bind the delegated `click` and `change` listeners on document.
 * @param {Object<string, Function>} actions - Click action map (data-action)
 * @param {Object<string, Function>} changes - Change action map (data-change)
 */
export function bindDelegation(actions, changes) {
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const fn = actions[el.dataset.action];
    if (fn) {
      e.preventDefault?.();
      fn(el, e);
    }
  });

  document.addEventListener('change', (e) => {
    const el = e.target.closest('[data-change]');
    if (!el) return;
    changes[el.dataset.change]?.(el, e);
  });
}
