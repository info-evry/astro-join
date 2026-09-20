/**
 * CSV import tab.
 */
import { $, escapeHtml } from '@info-evry/astro-design/scripts/dom';
import { toastSuccess, toastError } from '@info-evry/astro-design/scripts/toast';
import { state } from '../state.js';

function handleImportFileChange(event) {
  const importBtn = $('import-btn');
  const importPreview = $('import-preview');
  const file = event.target.files[0];
  if (!file) {
    importBtn.disabled = true;
    importPreview.classList.add('hidden');
    state.importData = null;
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    state.importData = e.target.result;

    const lines = state.importData.trim().split('\n').slice(0, 6);
    const previewHtml = lines.map((line, i) => {
      const cells = line.split(/[,;\t]/).slice(0, 5);
      return `<tr class="${i === 0 ? 'header-row' : ''}">
        ${cells.map((c) => `<td>${escapeHtml(c.replaceAll(/(?:^")|(?:"$)/g, '').trim())}</td>`).join('')}
        ${cells.length < 5 ? '<td>...</td>' : ''}
      </tr>`;
    }).join('');

    $('import-preview-content').innerHTML = `
      <table class="data-table" style="font-size: var(--text-xs);">
        <tbody>${previewHtml}</tbody>
      </table>
      <p style="color: var(--color-text-muted); margin-top: var(--space-2);">
        ${state.importData.trim().split('\n').length - 1} ligne(s) de données
      </p>
    `;
    importPreview.classList.remove('hidden');
    importBtn.disabled = false;
  };
  reader.readAsText(file);
}

async function handleImport(api, loadData) {
  if (!state.importData) return;

  const importBtn = $('import-btn');
  const importResult = $('import-result');
  importBtn.disabled = true;
  importBtn.textContent = 'Import en cours...';

  try {
    const result = await api('/admin/import', {
      method: 'POST',
      body: JSON.stringify({ csv: state.importData })
    });

    const stats = result.stats;
    let message = `Import terminé: ${stats.imported} ajouté(s), ${stats.updated} mis à jour`;
    if (stats.skipped > 0) message += `, ${stats.skipped} ignoré(s)`;

    importResult.innerHTML = `
      <div class="toast success" style="position: static; transform: none;">
        ${message}
      </div>
      ${result.errors ? `
        <div style="margin-top: var(--space-2); color: var(--color-error); font-size: var(--text-sm);">
          <strong>Erreurs:</strong>
          <ul>${result.errors.map((e) => `<li>${escapeHtml(e)}</li>`).join('')}</ul>
        </div>
      ` : ''}
    `;
    importResult.classList.remove('hidden');

    toastSuccess(message);
    loadData();

    $('import-file').value = '';
    $('import-preview').classList.add('hidden');
    state.importData = null;
  } catch (error) {
    toastError(error.message);
    importResult.innerHTML = `
      <div class="toast error" style="position: static; transform: none;">
        Erreur: ${escapeHtml(error.message)}
      </div>
    `;
    importResult.classList.remove('hidden');
  }

  importBtn.disabled = true;
  importBtn.textContent = 'Importer';
}

export function initImport(api, loadData) {
  $('import-file').addEventListener('change', handleImportFileChange);
  $('import-btn').addEventListener('click', () => handleImport(api, loadData));
}
