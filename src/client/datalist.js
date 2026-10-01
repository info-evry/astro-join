/**
 * Fill a <datalist> with the configured enrollment tracks (the static options
 * in the page are only the defaults, shown until the configuration is loaded).
 */
import { escapeHtml } from '@info-evry/astro-design/scripts/dom';

/**
 * @param {HTMLElement | null} list - the <datalist>
 * @param {unknown} tracks - configured tracks; anything but a non-empty array leaves the list alone
 */
export function fillTrackList(list, tracks) {
  if (!list || !Array.isArray(tracks) || tracks.length === 0) return;
  list.innerHTML = tracks.map((track) => `<option value="${escapeHtml(track)}"></option>`).join('');
}
