/* global document, Event, Element */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { settle, isolateDocumentListeners, XSS_ATTRIBUTE } from './helpers.js';

isolateDocumentListeners();

/** Markup mirroring the form of src/pages/index.astro (ids and field names). */
const FORM_DOM = `
  <p id="membership-closed" class="form-notice hidden" role="status"></p>
  <form id="membership-form">
    <input name="firstName" id="first-name">
    <input name="lastName" id="last-name">
    <input name="email" id="email" type="email">
    <input name="studentId" id="student-id">
    <input name="enrollmentTrack" id="enrollment-track" list="cursus-list">
    <datalist id="cursus-list"><option value="Défaut"></option></datalist>
    <input name="phone" id="phone">
    <input name="telegram" id="telegram">
    <input name="discord" id="discord">
    <div id="form-errors" class="errors hidden"></div>
    <button type="submit" id="submit-btn">Envoyer ma demande</button>
  </form>
  <div id="success-modal" class="modal hidden"><p id="success-message"></p></div>
`;

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

const byId = (id) => document.getElementById(id);
const hidden = (id) => byId(id).classList.contains('hidden');
const optionValues = () => [...byId('cursus-list').querySelectorAll('option')].map((option) => option.value);

let fetchMock;
let config;

/** A fetch stub: GET /api/config answers `config`, POST /api/apply answers `applyResponse()`. */
function stubServer({ applyResponse = () => json({ success: true, message: 'Demande enregistrée' }) } = {}) {
  fetchMock = vi.fn(async (url, options = {}) => {
    if (url.endsWith('/api/config')) return config();
    if (url.endsWith('/api/apply') && options.method === 'POST') return applyResponse(options);
    return json({ error: 'Ressource introuvable', code: 'not_found' }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
}

async function boot() {
  vi.resetModules();
  document.body.innerHTML = FORM_DOM;
  await import('../../src/client/membership-form.js');
  await settle();
}

function fill(values) {
  for (const [name, value] of Object.entries(values)) document.querySelector(`[name="${name}"]`).value = value;
}

async function submit() {
  byId('membership-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await settle();
}

const VALID = { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@test.example', enrollmentTrack: 'L3 Informatique', discord: '@ada' };

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  config = () => json({ config: { membershipOpen: true, currentYear: '2025-2026', enrollmentTracks: ['L3 Informatique', 'M1 "Info"'] } });
  stubServer();
});

afterEach(() => vi.unstubAllGlobals());

describe('configuration', () => {
  it('reads /api/config and offers the configured tracks (escaped) instead of the defaults', async () => {
    await boot();

    expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/config$/);
    expect(optionValues()).toEqual(['L3 Informatique', 'M1 "Info"']);
  });

  it('leaves an open form usable', async () => {
    await boot();

    expect(hidden('membership-closed')).toBe(true);
    expect(byId('submit-btn').disabled).toBe(false);
    expect([...byId('membership-form').elements].every((control) => !control.disabled)).toBe(true);
  });

  it('disables the whole form and explains why when membershipOpen is false', async () => {
    config = () => json({ config: { membershipOpen: false, enrollmentTracks: ['A'] } });
    await boot();

    expect([...byId('membership-form').elements].every((control) => control.disabled)).toBe(true);
    expect(hidden('membership-closed')).toBe(false);
    expect(byId('membership-closed').textContent).toContain('fermées');
  });

  it('keeps the form usable when the configuration cannot be read (the server enforces the rules)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    config = () => new Response('<html>502</html>', { status: 502 });
    await boot();

    expect(byId('submit-btn').disabled).toBe(false);
    expect(optionValues()).toEqual(['Défaut']);
  });

  it('keeps the form usable when the network is down', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    config = () => { throw new TypeError('Failed to fetch'); };
    await boot();
    expect(byId('submit-btn').disabled).toBe(false);
  });
});

describe('submitting', () => {
  it('validates locally with the shared email rule, without any request', async () => {
    await boot();
    fetchMock.mockClear();
    fill({ ...VALID, email: 'not-an-email' });

    await submit();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(hidden('form-errors')).toBe(false);
    expect(byId('form-errors').textContent).toContain("L'email est invalide");
  });

  it('POSTs the trimmed fields as JSON and shows the server message', async () => {
    await boot();
    fill({ ...VALID, firstName: '  Ada  ' });

    await submit();

    const [url, options] = fetchMock.mock.calls.at(-1);
    expect(url).toMatch(/\/api\/apply$/);
    expect(JSON.parse(options.body)).toMatchObject({ firstName: 'Ada', email: 'ada@test.example', enrollmentTrack: 'L3 Informatique' });
    expect(hidden('success-modal')).toBe(false);
    expect(byId('success-message').textContent).toBe('Demande enregistrée');
  });

  it('shows the server validation message as text, never as markup', async () => {
    stubServer({ applyResponse: () => json({ error: XSS_ATTRIBUTE, code: 'validation_error' }, 400) });
    await boot();
    fill(VALID);

    await submit();

    expect(byId('form-errors').querySelector('img')).toBeNull();
    expect(byId('form-errors').textContent).toBe(XSS_ATTRIBUTE);
    expect(byId('submit-btn').disabled).toBe(false);
    expect(byId('submit-btn').textContent).toBe('Envoyer ma demande');
  });

  it('survives a non-JSON error page (502) with a French message instead of a SyntaxError', async () => {
    stubServer({ applyResponse: () => new Response('<html>Bad gateway</html>', { status: 502 }) });
    await boot();
    fill(VALID);

    await submit();

    expect(byId('form-errors').textContent).toBe('Service momentanément indisponible');
    expect(byId('submit-btn').disabled).toBe(false);
  });

  it('survives a network failure', async () => {
    stubServer({ applyResponse: () => { throw new TypeError('Failed to fetch'); } });
    await boot();
    fill(VALID);

    await submit();

    expect(byId('form-errors').textContent).toBe('Impossible de contacter le serveur');
  });

  it('closes the form when the server answers 403 membership_closed (closed after the page loaded)', async () => {
    stubServer({ applyResponse: () => json({ error: 'Les adhésions sont fermées.', code: 'membership_closed' }, 403) });
    await boot();
    fill(VALID);

    await submit();

    expect(byId('membership-closed').textContent).toBe('Les adhésions sont fermées.');
    expect(hidden('membership-closed')).toBe(false);
    expect(byId('submit-btn').disabled).toBe(true);
    expect(hidden('form-errors')).toBe(true);
  });
});
