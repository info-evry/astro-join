/**
 * Admin action/change delegation
 *
 * Builds the lookup maps consumed by astro-design's `bindDelegation` (called
 * from main.js): `data-action` (click) and `data-change` (change) attributes
 * replace inline handlers and globals.
 */

import { numberOrNull } from '@info-evry/astro-design/scripts/dom';
import { toggleSort, toggleSelectAll, toggleMemberSelection } from './features/members.js';
import { editMember, confirmDeleteMember, bulkApprove, bulkSetStatus, bulkDelete } from './features/member-actions.js';
import { approveMember, rejectMember, approveAll } from './features/pending.js';

/** The member id of an action element, or null when its data-member-id is missing or not a number. */
const memberIdOf = (el) => numberOrNull(el.dataset.memberId);

/** Run `handler(id)` for the element's member id; ignore elements without a usable one. */
const withMemberId = (handler) => (el) => {
  const id = memberIdOf(el);
  return id === null ? undefined : handler(id);
};

/**
 * Build the click-action ("actions") and change-action ("changes") lookup
 * maps used by `bindDelegation`.
 * @param {Object} deps
 * @param {Function} deps.api - API client function
 * @param {Function} deps.loadData - Reload callback
 * @returns {{actions: Object<string, Function>, changes: Object<string, Function>}}
 */
export function buildActions({ api, loadData }) {
  const actions = {
    'edit-member': withMemberId((id) => editMember(id)),
    'confirm-delete-member': withMemberId((id) => confirmDeleteMember(id, api, loadData)),
    'approve-member': withMemberId((id) => approveMember(id, api, loadData)),
    'reject-member': withMemberId((id) => rejectMember(id, api, loadData)),
    'sort-members': (el) => toggleSort(el.dataset.field),
    'approve-all': () => approveAll(api, loadData),
    'bulk-approve': () => bulkApprove(api, loadData),
    'bulk-set-status': (el) => bulkSetStatus(el.dataset.status, api, loadData),
    'bulk-delete': () => bulkDelete(api, loadData)
  };

  const changes = {
    'toggle-select-all': (el) => toggleSelectAll(el.checked),
    'toggle-member-select': (el) => {
      const id = memberIdOf(el);
      if (id !== null) toggleMemberSelection(id, el.checked);
    }
  };

  return { actions, changes };
}
