/* global Event */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountAdminDom, byId, settle, currentToast, click, change } from './helpers.js';

let settings;
let api;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  mountAdminDom();
  settings = await import('../../src/client/admin/features/settings.js');
  api = vi.fn();
});

afterEach(() => vi.useRealTimers());

describe('loadSettings', () => {
  it.each([
    [true, true], ['true', true], [false, false], ['false', false], [undefined, false], ['yes', false]
  ])('shows membership_open=%j as checked=%s', async (value, checked) => {
    api.mockResolvedValue({ settings: { membership_open: value, current_year: '2026-2027' } });
    byId('setting-membership-open').checked = !checked;

    await settings.loadSettings(api);

    expect(api).toHaveBeenCalledWith('/admin/settings');
    expect(byId('setting-membership-open').checked).toBe(checked);
  });

  it('shows the stored academic year, or the default when absent', async () => {
    api.mockResolvedValueOnce({ settings: { current_year: '2026-2027' } });
    await settings.loadSettings(api);
    expect(byId('setting-current-year').value).toBe('2026-2027');

    api.mockResolvedValueOnce({ settings: {} });
    await settings.loadSettings(api);
    expect(byId('setting-current-year').value).toBe('2024-2025');
  });

  it('leaves the save button disabled (nothing to save yet)', async () => {
    byId('save-settings-btn').disabled = false;
    api.mockResolvedValue({ settings: {} });
    await settings.loadSettings(api);
    expect(byId('save-settings-btn').disabled).toBe(true);
  });

  it('propagates API failures so the caller can handle auth errors', async () => {
    api.mockRejectedValue(new Error('Unauthorized'));
    await expect(settings.loadSettings(api)).rejects.toThrow('Unauthorized');
  });
});

describe('saveSettings', () => {
  it.each([[true, 'true'], [false, 'false']])('sends membership_open=%s as the string "%s"', async (checked, sent) => {
    api.mockResolvedValue({ success: true });
    byId('setting-membership-open').checked = checked;
    byId('setting-current-year').value = '2026-2027';

    await settings.saveSettings(api);

    const [endpoint, options] = api.mock.calls[0];
    expect(endpoint).toBe('/admin/settings');
    expect(options.method).toBe('PUT');
    expect(JSON.parse(options.body)).toEqual({ membership_open: sent, current_year: '2026-2027' });
  });

  it('toasts success and disables the save button again', async () => {
    api.mockResolvedValue({ success: true });
    byId('save-settings-btn').disabled = false;

    await settings.saveSettings(api);

    expect(currentToast().textContent).toBe('Paramètres enregistrés');
    expect(currentToast().classList.contains('success')).toBe(true);
    expect(byId('save-settings-btn').disabled).toBe(true);
  });

  it('shows the server validation message and keeps the button enabled on failure', async () => {
    api.mockRejectedValue(new Error('Invalid value for setting key(s): current_year'));
    byId('save-settings-btn').disabled = false;

    await settings.saveSettings(api);

    expect(currentToast().textContent).toBe('Invalid value for setting key(s): current_year');
    expect(currentToast().classList.contains('error')).toBe(true);
    expect(byId('save-settings-btn').disabled).toBe(false);
  });
});

describe('initSettings', () => {
  beforeEach(() => {
    api.mockResolvedValue({ success: true });
    settings.initSettings(api);
  });

  it('enables save when the checkbox changes', () => {
    change(byId('setting-membership-open'));
    expect(byId('save-settings-btn').disabled).toBe(false);
  });

  it('enables save while typing the year', () => {
    byId('setting-current-year').dispatchEvent(new Event('input', { bubbles: true }));
    expect(byId('save-settings-btn').disabled).toBe(false);
  });

  it('saves when the button is clicked', async () => {
    byId('save-settings-btn').disabled = false;
    click(byId('save-settings-btn'));
    await settle();
    expect(api).toHaveBeenCalledTimes(1);
    expect(byId('save-settings-btn').disabled).toBe(true);
  });
});
