/**
 * The public membership page: the HTML maxlength attributes come from the same
 * LIMITS the API enforces, so they cannot drift apart again.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { SELF } from 'cloudflare:test';
import { LIMITS } from 'astro-core/validation';
import { defaultAcademicYear, DEFAULT_ENROLLMENT_TRACKS } from '../src/shared/membership.js';
import { BASE } from './helpers.js';

let html;

beforeAll(async () => {
  const response = await SELF.fetch(`${BASE}/`);
  expect(response.status).toBe(200);
  html = await response.text();
});

/** The opening tag of the form control called `name`. */
function control(name) {
  const tag = new RegExp(String.raw`<(?:input|textarea)[^>]*\bname="${name}"[^>]*>`).exec(html);
  expect(tag, `control ${name}`).not.toBeNull();
  return tag[0];
}

describe('public form', () => {
  it.each([
    ['firstName', LIMITS.name],
    ['lastName', LIMITS.name],
    ['email', LIMITS.email],
    ['studentId', LIMITS.studentId],
    ['phone', LIMITS.phone],
    ['telegram', LIMITS.handle],
    ['discord', LIMITS.handle]
  ])('limits %s to the shared limit (%i)', (name, limit) => {
    expect(control(name)).toContain(`maxlength="${limit}"`);
  });

  it('starts with the default tracks, which the page replaces by the configured ones', () => {
    for (const track of DEFAULT_ENROLLMENT_TRACKS) expect(html).toContain(`value="${track}"`);
    expect(html).not.toContain('Doctorat Informatique');
  });

  it('has the closed-membership notice, hidden until the configuration says so', () => {
    expect(html).toMatch(/<p[^>]*id="membership-closed"[^>]*class="[^"]*hidden/);
  });
});

/** The text a reader sees: tags removed, runs of whitespace collapsed (as HTML renders them). */
function visibleText(fragment) {
  return fragment
    .replaceAll(/<[^<>]*>/g, '')
    .replaceAll(/\s+/g, ' ')
    .trim();
}

describe('rendered text', () => {
  it('links the contact channels without stray spaces', () => {
    const start = html.indexOf('Contactez-nous');
    expect(start).toBeGreaterThan(-1);
    const paragraph = html.slice(start, html.indexOf('</p>', start));
    expect(visibleText(paragraph)).toBe('Contactez-nous sur Discord, Telegram ou par email à asso@info-evry.fr.');
  });

  it('shows the running academic year in the hero badge', () => {
    expect(html).toContain(`Adhésion ${defaultAcademicYear()}`);
  });
});
