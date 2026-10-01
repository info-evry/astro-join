/**
 * Settings tab: membership-open toggle + current academic year.
 *
 * GET /api/admin/settings returns PARSED values (booleans are booleans, the
 * tracks an array), so `membership_open` is read as a boolean only. A missing
 * value means "open", like on the server.
 */
import { $ } from '@info-evry/astro-design/scripts/dom';
import { toastSuccess, toastError } from '@info-evry/astro-design/scripts/toast';
import { DEFAULT_ACADEMIC_YEAR, DEFAULT_ENROLLMENT_TRACKS } from '../../../shared/membership.js';
import { fillTrackList } from '../../datalist.js';

const SAVE_SETTINGS_BTN = 'save-settings-btn';

export async function loadSettings(api) {
  const { settings } = await api('/admin/settings');
  $('setting-membership-open').checked = settings.membership_open !== false;
  $('setting-current-year').value = settings.current_year || DEFAULT_ACADEMIC_YEAR;
  // The member edit form only offers (and the API only accepts) the configured tracks
  fillTrackList($('admin-cursus-list'), settings.enrollment_tracks ?? DEFAULT_ENROLLMENT_TRACKS);
  $(SAVE_SETTINGS_BTN).disabled = true;
}

export async function saveSettings(api) {
  try {
    await api('/admin/settings', {
      method: 'PUT',
      body: JSON.stringify({
        membership_open: $('setting-membership-open').checked,
        current_year: $('setting-current-year').value
      })
    });
    toastSuccess('Paramètres enregistrés');
    $(SAVE_SETTINGS_BTN).disabled = true;
  } catch (error) {
    toastError(error.message);
  }
}

function markSettingsDirty() {
  $(SAVE_SETTINGS_BTN).disabled = false;
}

export function initSettings(api) {
  $(SAVE_SETTINGS_BTN).addEventListener('click', () => saveSettings(api));
  $('setting-membership-open').addEventListener('change', markSettingsDirty);
  $('setting-current-year').addEventListener('input', markSettingsDirty);
}
