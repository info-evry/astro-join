/* global Event */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  mountAdminDom, byId, settle, currentToast, isHidden, click, XSS_ATTRIBUTE, XSS_APOSTROPHE
} from './helpers.js';

let state;
let api;
let loadData;

class FakeFileReader {
  readAsText(file) {
    this.onload({ target: { result: file.text } });
  }
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  vi.stubGlobal('FileReader', FakeFileReader);
  mountAdminDom();
  state = (await import('../../src/client/admin/state.js')).state;
  const { initImport } = await import('../../src/client/admin/features/import.js');
  api = vi.fn().mockResolvedValue({ stats: { imported: 0, updated: 0, skipped: 0 } });
  loadData = vi.fn();
  initImport(api, loadData);
});

afterEach(() => vi.useRealTimers());

/** Simulate choosing a file (or clearing the input when `text` is null). */
function chooseFile(text) {
  const input = byId('import-file');
  Object.defineProperty(input, 'files', { value: text === null ? [] : [{ text }], configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

const previewRows = () => [...byId('import-preview-content').querySelectorAll('tbody tr')];
const previewCells = (row) => [...row.querySelectorAll('td')].map((cell) => cell.textContent);

describe('file selection and preview', () => {
  it('starts with the import button disabled and the preview hidden', () => {
    expect(byId('import-btn').disabled).toBe(true);
    expect(isHidden('import-preview')).toBe(true);
  });

  it('stores the file text, shows the preview and enables the button', () => {
    chooseFile('Prénom,Nom,Email\nAda,Lovelace,ada@x.fr');

    expect(state.importData).toBe('Prénom,Nom,Email\nAda,Lovelace,ada@x.fr');
    expect(isHidden('import-preview')).toBe(false);
    expect(byId('import-btn').disabled).toBe(false);
  });

  it('marks the first line as the header row', () => {
    chooseFile('Prénom,Nom,Email\nAda,Lovelace,ada@x.fr');
    const rows = previewRows();
    expect(rows[0].classList.contains('header-row')).toBe(true);
    expect(rows[1].classList.contains('header-row')).toBe(false);
    expect(previewCells(rows[1]).slice(0, 3)).toEqual(['Ada', 'Lovelace', 'ada@x.fr']);
  });

  it('previews at most six lines and five cells per line', () => {
    const lines = ['a,b,c,d,e,f,g', ...Array.from({ length: 10 }, (_, i) => `r${i},2,3,4,5,6,7`)];
    chooseFile(lines.join('\n'));

    expect(previewRows()).toHaveLength(6);
    expect(previewCells(previewRows()[0])).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('reports the number of data lines, not just the previewed ones', () => {
    chooseFile(['h1,h2', ...Array.from({ length: 10 }, (_, i) => `r${i},x`)].join('\n'));
    expect(byId('import-preview-content').textContent).toContain('10 ligne(s) de données');
  });

  it('handles semicolon and tab separators and strips surrounding quotes', () => {
    chooseFile('"Prénom";"Nom"\n"Ada"\t"Lovelace"');
    expect(previewCells(previewRows()[0]).slice(0, 2)).toEqual(['Prénom', 'Nom']);
    expect(previewCells(previewRows()[1]).slice(0, 2)).toEqual(['Ada', 'Lovelace']);
  });

  it.each([
    ['a quote/tag breakout', XSS_ATTRIBUTE],
    ['apostrophes', XSS_APOSTROPHE],
    ['a script tag', '<script>alert(1)</script>']
  ])('shows %s as text, not markup', (_label, payload) => {
    const cell = `x${payload}`;
    chooseFile(`Prénom,Nom\n${cell},y`);
    expect(byId('import-preview-content').querySelector('img, script')).toBeNull();
    expect(byId('import-preview-content').innerHTML).not.toContain('<img');
    expect(previewCells(previewRows()[1])[0]).toBe(cell);
  });

  it('resets everything when the selection is cleared', () => {
    chooseFile('a,b\n1,2');
    chooseFile(null);

    expect(state.importData).toBeNull();
    expect(isHidden('import-preview')).toBe(true);
    expect(byId('import-btn').disabled).toBe(true);
  });
});

describe('running the import', () => {
  const run = async () => {
    click(byId('import-btn'));
    await settle();
  };

  beforeEach(() => chooseFile('Prénom,Nom,Email\nAda,Lovelace,ada@x.fr'));

  it('does nothing without file data', async () => {
    state.importData = null;
    await run();
    expect(api).not.toHaveBeenCalled();
  });

  it('POSTs the raw CSV text as JSON', async () => {
    await run();
    const [endpoint, options] = api.mock.calls[0];
    expect(endpoint).toBe('/admin/import');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual({ csv: 'Prénom,Nom,Email\nAda,Lovelace,ada@x.fr' });
  });

  it('disables the button and shows progress while the request is in flight', async () => {
    let finish;
    api.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    click(byId('import-btn'));
    await settle();

    expect(byId('import-btn').disabled).toBe(true);
    expect(byId('import-btn').textContent).toBe('Import en cours...');

    finish({ stats: { imported: 1, updated: 0, skipped: 0 } });
    await settle();
    expect(byId('import-btn').textContent).toBe('Importer');
  });

  it('summarises the result, toasts, reloads and resets the form', async () => {
    api.mockResolvedValueOnce({ stats: { imported: 2, updated: 1, skipped: 0 } });
    await run();

    expect(isHidden('import-result')).toBe(false);
    expect(byId('import-result').querySelector('.import-banner.success').textContent.trim())
      .toBe('Import terminé: 2 ajouté(s), 1 mis à jour');
    expect(byId('import-result').textContent).not.toContain('ignoré');
    expect(byId('import-result').textContent).not.toContain('Erreurs');
    expect(currentToast().textContent).toBe('Import terminé: 2 ajouté(s), 1 mis à jour');
    expect(loadData).toHaveBeenCalledTimes(1);
    expect(state.importData).toBeNull();
    expect(isHidden('import-preview')).toBe(true);
    expect(byId('import-btn').disabled).toBe(true);
    expect(byId('import-btn').textContent).toBe('Importer');
  });

  it('mentions skipped rows and lists the reported errors', async () => {
    api.mockResolvedValueOnce({
      stats: { imported: 1, updated: 0, skipped: 2 },
      errors: ['Row 3: Invalid email format', 'Row 5: Missing required fields']
    });
    await run();

    const text = byId('import-result').textContent;
    expect(text).toContain('2 ignoré(s)');
    expect(text).toContain('Erreurs');
    expect([...byId('import-result').querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      'Row 3: Invalid email format', 'Row 5: Missing required fields'
    ]);
  });

  it('escapes server-reported errors that echo row content', async () => {
    api.mockResolvedValueOnce({
      stats: { imported: 0, updated: 0, skipped: 1 },
      errors: [`Row 2: ${XSS_ATTRIBUTE}`]
    });
    await run();

    expect(byId('import-result').querySelector('img')).toBeNull();
    expect(byId('import-result').querySelector('li').textContent).toBe(`Row 2: ${XSS_ATTRIBUTE}`);
  });

  it('keeps the result banner when the toast for it is shown (they must not share a class)', async () => {
    await run();
    expect(byId('import-result').querySelector('.import-banner')).not.toBeNull();
    expect(byId('import-result').querySelector('.toast')).toBeNull();
    expect(currentToast()).not.toBeNull();
  });

  it('shows a failed import as an escaped error without reloading', async () => {
    api.mockRejectedValueOnce(new Error(`Failed to import CSV: ${XSS_ATTRIBUTE}`));
    await run();

    expect(currentToast().classList.contains('error')).toBe(true);
    expect(byId('import-result').querySelector('.import-banner.error')).not.toBeNull();
    expect(isHidden('import-result')).toBe(false);
    expect(byId('import-result').querySelector('img')).toBeNull();
    expect(byId('import-result').textContent).toContain(`Erreur: Failed to import CSV: ${XSS_ATTRIBUTE}`);
    expect(loadData).not.toHaveBeenCalled();
    expect(byId('import-btn').textContent).toBe('Importer');
  });
});
