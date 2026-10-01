/**
 * The shared membership model (src/shared/membership.js) and its consistency
 * with db/schema.sql and the member forms.
 */
import { describe, it, expect } from 'vitest';
import schemaSql from '../db/schema.sql?raw';
import { sqlList } from '../src/lib/sql.js';
import {
  ACTIVE_STATUSES, BATCH_STATUSES, BUREAU_ROLES, DEFAULT_ACADEMIC_YEAR, DEFAULT_ENROLLMENT_TRACKS,
  STATUS_LABELS, UNIQUE_BUREAU_ROLES, VALID_STATUSES,
  approvalDates, expiryDateFor, isActiveStatus, isBureauRole, isUniqueBureauRole, isValidStatus,
  normalizeEmail, sqlTimestamp, statusFromLabel, statusLabel
} from '../src/shared/membership.js';

describe('status vocabulary', () => {
  it('has one French label per status, in the canonical order', () => {
    expect(VALID_STATUSES).toEqual([
      'pending', 'active', 'honor', 'secretary', 'treasurer', 'president',
      'honorary_president', 'vice_president', 'rejected', 'expired'
    ]);
    expect(Object.keys(STATUS_LABELS)).toEqual([...VALID_STATUSES]);
    expect(statusLabel('vice_president')).toBe('Vice-président');
    expect(statusLabel('nope')).toBe('nope');
    expect(statusLabel()).toBe('');
  });

  it('keeps the bureau in display order and only the first four unique', () => {
    expect([...BUREAU_ROLES]).toEqual(['president', 'vice_president', 'secretary', 'treasurer', 'honorary_president']);
    expect([...UNIQUE_BUREAU_ROLES]).toEqual(['president', 'vice_president', 'secretary', 'treasurer']);
    expect(isUniqueBureauRole('honorary_president')).toBe(false);
    expect(isBureauRole('honorary_president')).toBe(true);
    expect(isBureauRole('active')).toBe(false);
  });

  it('counts active, honor and every bureau role as active', () => {
    expect([...ACTIVE_STATUSES].sort()).toEqual(
      ['active', 'honor', 'honorary_president', 'president', 'secretary', 'treasurer', 'vice_president']
    );
    for (const status of ['pending', 'rejected', 'expired', '', null, undefined, 5]) {
      expect(isActiveStatus(status)).toBe(false);
    }
    expect(isValidStatus('__proto__')).toBe(false);
    expect([...BATCH_STATUSES]).toEqual(['active', 'rejected', 'expired']);
  });

  it('is frozen: no consumer can change the vocabulary at runtime', () => {
    expect(Object.isFrozen(STATUS_LABELS)).toBe(true);
    expect(Object.isFrozen(VALID_STATUSES)).toBe(true);
    expect(Object.isFrozen(ACTIVE_STATUSES)).toBe(true);
    expect(Object.isFrozen(DEFAULT_ENROLLMENT_TRACKS)).toBe(true);
  });
});

describe('statusFromLabel', () => {
  it.each([
    ['Membre actif', 'active'], ['actif', 'active'], ['ACTIF', 'active'], ["Membre d'honneur", 'honor'], ['membre d’honneur', 'honor'],
    ['Honneur', 'honor'], ['Secrétaire', 'secretary'], ['secretaire', 'secretary'], ['TRÉSORIER', 'treasurer'],
    ['Président', 'president'], ["Président d'honneur", 'honorary_president'], ["president d'honneur", 'honorary_president'],
    ['Vice-président', 'vice_president'], ['Vice Président', 'vice_president'], ['vice president', 'vice_president'],
    ['En attente', 'pending'], ['Refusé', 'rejected'], ['expire', 'expired'],
    ['vice_president', 'vice_president'], ['honorary_president', 'honorary_president'], ['  pending  ', 'pending']
  ])('maps %j to %s', (label, status) => {
    expect(statusFromLabel(label)).toBe(status);
  });

  it.each(['', '   ', 'chef', 'activee', '__proto__', 'constructor', 'toString', null, undefined, 5, {}])(
    'does not guess a status for %j',
    (label) => expect(statusFromLabel(label)).toBeNull()
  );

  it('round-trips every internal value and every label', () => {
    for (const status of VALID_STATUSES) {
      expect(statusFromLabel(status)).toBe(status);
      expect(statusFromLabel(STATUS_LABELS[status])).toBe(status);
    }
  });
});

describe('expiryDateFor', () => {
  it.each([
    ['2031-01-15T12:00:00Z', '2031-08-31'],
    ['2031-08-31T23:59:59Z', '2031-08-31'],
    ['2031-09-01T00:00:00Z', '2032-08-31'],
    ['2031-12-31T23:59:59Z', '2032-08-31'],
    ['2032-02-29T12:00:00Z', '2032-08-31']
  ])('ends the academic year of %s on %s', (date, expected) => {
    expect(expiryDateFor(new Date(date))).toBe(expected);
    expect(expiryDateFor(date)).toBe(expected);
  });

  it('defaults to now', () => {
    expect(expiryDateFor()).toBe(expiryDateFor(new Date()));
  });
});

describe('approval bookkeeping', () => {
  const now = new Date('2031-09-02T10:20:30Z');

  it('formats timestamps like SQLite CURRENT_TIMESTAMP', () => {
    expect(sqlTimestamp(now)).toBe('2031-09-02 10:20:30');
  });

  it('approves a member entering the active set, and only then', () => {
    const approved = { approvedAt: '2031-09-02 10:20:30', expiresAt: '2032-08-31' };
    for (const from of [null, undefined, 'pending', 'rejected', 'expired']) {
      expect(approvalDates(from, 'active', now)).toEqual(approved);
      expect(approvalDates(from, 'president', now)).toEqual(approved);
    }
    expect(approvalDates('active', 'honor', now)).toBeNull();
    expect(approvalDates('treasurer', 'honorary_president', now)).toBeNull();
    expect(approvalDates('active', 'expired', now)).toBeNull();
    expect(approvalDates('pending', 'rejected', now)).toBeNull();
  });
});

describe('normalizeEmail', () => {
  it('trims and lower-cases, and maps non-strings to an empty string', () => {
    expect(normalizeEmail('  Ada@Test.EXAMPLE ')).toBe('ada@test.example');
    expect(normalizeEmail()).toBe('');
    expect(normalizeEmail(5)).toBe('');
  });
});

describe('consistency with db/schema.sql', () => {
  it('seeds the same default academic year', () => {
    expect(schemaSql).toContain(`('current_year', '${DEFAULT_ACADEMIC_YEAR}')`);
  });

  it('seeds the default enrollment tracks', () => {
    expect(schemaSql).toContain(JSON.stringify([...DEFAULT_ENROLLMENT_TRACKS]));
  });

  it('creates members.enrollment_number itself', () => {
    expect(schemaSql).toMatch(/enrollment_number TEXT/);
  });

  it('leaves status free text (no CHECK constraint): the application owns the vocabulary', () => {
    expect(schemaSql).not.toMatch(/CHECK\s*\(/i);
  });
});

describe('sqlList', () => {
  it('renders constants as SQL string literals', () => {
    expect(sqlList(['active', 'vice_president'])).toBe("'active', 'vice_president'");
    expect(sqlList([...ACTIVE_STATUSES])).toContain("'honorary_president'");
  });

  it.each(["x'; DROP TABLE members;--", 'Active', 'a b', '', 5, null])('refuses the unsafe value %j', (value) => {
    expect(() => sqlList(['ok', value])).toThrow(TypeError);
  });
});
