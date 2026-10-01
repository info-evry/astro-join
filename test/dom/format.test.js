import { describe, it, expect } from 'vitest';
import {
  getContactInfo, getStatusClass, getStatusLabel, formatMemberDate, fullStatusLabel
} from '../../src/client/admin/format.js';
import { STATUS_LABELS } from '../../src/client/admin/state.js';
import { XSS_ATTRIBUTE } from './helpers.js';

describe('getContactInfo', () => {
  it('joins the available contacts with line breaks, in phone/telegram/discord order', () => {
    expect(getContactInfo({ phone: '0102', telegram: '@tg', discord: '@dc' }))
      .toBe('Tel: 0102<br>TG: @tg<br>DC: @dc');
  });

  it('skips missing contacts', () => {
    expect(getContactInfo({ phone: null, telegram: '@tg', discord: '' })).toBe('TG: @tg');
  });

  it('shows a dash when there is no contact at all', () => {
    expect(getContactInfo({ phone: null, telegram: null, discord: null })).toBe('-');
  });

  it('escapes HTML in every contact value', () => {
    const html = getContactInfo({ phone: XSS_ATTRIBUTE, telegram: '<b>x</b>', discord: "'&" });
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&#39;&amp;');
  });
});

describe('status helpers', () => {
  it.each([
    ['active', 'success'], ['pending', 'warning'], ['rejected', 'error'], ['expired', 'secondary']
  ])('maps %s to the %s badge class', (status, cssClass) => {
    expect(getStatusClass(status)).toBe(cssClass);
  });

  it.each(['secretary', 'president', 'honor', 'something-else'])('falls back to the secondary class for %s', (status) => {
    expect(getStatusClass(status)).toBe('secondary');
  });

  it.each([
    ['active', 'Actif'], ['pending', 'En attente'], ['rejected', 'Refusé'], ['expired', 'Expiré']
  ])('uses the short table label for %s', (status, label) => {
    expect(getStatusLabel(status)).toBe(label);
  });

  it.each(Object.entries(STATUS_LABELS).filter(([status]) => !['active', 'pending', 'rejected', 'expired'].includes(status)))(
    'shows the French label for the %s role instead of the raw value',
    (status, label) => {
      expect(getStatusLabel(status)).toBe(label);
    }
  );

  it('returns an unknown status unchanged', () => {
    expect(getStatusLabel('mystery')).toBe('mystery');
    expect(fullStatusLabel('mystery')).toBe('mystery');
  });

  it('labels every server status with its French name', () => {
    expect(fullStatusLabel('honorary_president')).toBe("Président d'honneur");
    expect(fullStatusLabel('vice_president')).toBe('Vice-président');
  });
});

describe('formatMemberDate', () => {
  it.each([null, undefined, ''])('shows a dash for %j', (value) => {
    expect(formatMemberDate(value)).toBe('-');
  });

  it('formats as dd/mm/yyyy (fr-FR short date)', () => {
    expect(formatMemberDate('2025-03-15T12:00:00Z')).toBe('15/03/2025');
  });

  it('appends the time when asked', () => {
    const formatted = formatMemberDate('2025-03-15T12:00:00Z', true);
    expect(formatted).toMatch(/^15\/03\/2025/);
    expect(formatted).toMatch(/\d{2}:\d{2}/);
  });

  it('returns an empty string for an unparseable date instead of throwing', () => {
    expect(formatMemberDate('not a date')).toBe('');
  });
});
