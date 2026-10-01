/**
 * Guards the contract between the admin client code, the hand-written DOM
 * fixture used by the other DOM tests, and the real ManagePage.astro markup,
 * so a renamed id or removed element fails here instead of silently in prod.
 */
import { describe, it, expect } from 'vitest';
import managePage from '../../src/components/admin/ManagePage.astro?raw';
import { ADMIN_DOM } from './helpers.js';

const clientSources = import.meta.glob('../../src/client/admin/**/*.js', { query: '?raw', import: 'default', eager: true });

/** Ids the sidebar component generates from its `tabs` prop (not literal in the page). */
const SIDEBAR_BADGE_IDS = new Set(['members-badge', 'pending-badge']);

/** Ids rendered by the client itself inside the members table. */
const RENDERED_IDS = new Set(['select-all']);

const pageIds = new Set([...managePage.matchAll(/\bid="([\w-]+)"/g)].map((match) => match[1]));
const fixtureIds = new Set([...ADMIN_DOM.matchAll(/\bid="([\w-]+)"/g)].map((match) => match[1]));

/** Every element id the admin client looks up. */
function referencedIds() {
  const ids = new Set();
  const patterns = [
    /\$\(\s*'([\w-]+)'\s*\)/g,
    /(?:openModal|closeModal)\(\s*'([\w-]+)'\s*\)/g,
    /const [A-Z_]+ = '([\w-]+)';/g
  ];
  for (const source of Object.values(clientSources)) {
    for (const pattern of patterns) {
      for (const match of source.matchAll(pattern)) ids.add(match[1]);
    }
  }
  return ids;
}

describe('admin markup contract', () => {
  it('finds the client sources and the page markup', () => {
    expect(Object.keys(clientSources).length).toBeGreaterThanOrEqual(10);
    expect(pageIds.size).toBeGreaterThan(30);
  });

  it('every id the client looks up exists in ManagePage.astro', () => {
    const missing = [...referencedIds()]
      .filter((id) => !pageIds.has(id) && !SIDEBAR_BADGE_IDS.has(id) && !RENDERED_IDS.has(id));
    expect(missing).toEqual([]);
  });

  it('every id the client looks up exists in the DOM test fixture', () => {
    const missing = [...referencedIds()].filter((id) => !fixtureIds.has(id) && !RENDERED_IDS.has(id));
    expect(missing).toEqual([]);
  });

  it('the fixture does not invent ids missing from the real page', () => {
    const invented = [...fixtureIds].filter((id) => !pageIds.has(id) && !SIDEBAR_BADGE_IDS.has(id));
    expect(invented).toEqual([]);
  });

  it('every data-action in the real page has a registered handler', async () => {
    const { buildActions } = await import('../../src/client/admin/actions.js');
    const { actions } = buildActions({ api: () => {}, loadData: () => {} });
    const used = [...managePage.matchAll(/data-action="([\w-]+)"/g)].map((match) => match[1]);
    expect(used.length).toBeGreaterThan(0);
    expect(used.filter((name) => !Object.hasOwn(actions, name))).toEqual([]);
  });

  it('every data-action the client renders in tables has a registered handler', async () => {
    const { buildActions } = await import('../../src/client/admin/actions.js');
    const { actions } = buildActions({ api: () => {}, loadData: () => {} });
    const rendered = Object.values(clientSources)
      .flatMap((source) => [...source.matchAll(/data-action="([\w-]+)"/g)].map((match) => match[1]));
    expect(rendered.length).toBeGreaterThan(0);
    expect(rendered.filter((name) => !Object.hasOwn(actions, name))).toEqual([]);
  });

  it('every data-change the client renders has a registered handler', async () => {
    const { buildActions } = await import('../../src/client/admin/actions.js');
    const { changes } = buildActions({ api: () => {}, loadData: () => {} });
    const rendered = Object.values(clientSources)
      .flatMap((source) => [...source.matchAll(/data-change="([\w-]+)"/g)].map((match) => match[1]));
    expect(rendered.length).toBeGreaterThan(0);
    expect(rendered.filter((name) => !Object.hasOwn(changes, name))).toEqual([]);
  });

  it('the client source contains no inline event handler attributes', () => {
    const offenders = Object.entries(clientSources)
      .filter(([, source]) => /\son(?:click|change|input|submit|error|load)\s*=\s*["']/i.test(source))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });
});
