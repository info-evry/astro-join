/**
 * Settings tab: membership-open toggle + current academic year.
 */
import { $ } from '@info-evry/astro-design/scripts/dom';
import { toastSuccess, toastError } from '@info-evry/astro-design/scripts/toast';

const SAVE_SETTINGS_BTN = 'save-settings-btn';

export async function loadSettings(api) {
  const { settings } = await api('/admin/settings');
  const isOpen = settings.membership_open === true || settings.membership_open === 'true';
  $('setting-membership-open').checked = isOpen;
  $('setting-current-year').value = settings.current_year || '2024-2025';
  $(SAVE_SETTINGS_BTN).disabled = true;
}

export async function saveSettings(api) {
  try {
    await api('/admin/settings', {
      method: 'PUT',
      body: JSON.stringify({
        membership_open: $('setting-membership-open').checked ? 'true' : 'false',
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
