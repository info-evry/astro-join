import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  mountAdminDom, byId, makeMember, inlineHandlerAttributes, XSS_ATTRIBUTE, XSS_APOSTROPHE
} from './helpers.js';

let bureau;
let state;

beforeEach(async () => {
  vi.resetModules();
  mountAdminDom();
  state = (await import('../../src/client/admin/state.js')).state;
  bureau = await import('../../src/client/admin/features/bureau.js');
});

const container = () => byId('bureau-container');
const roles = () => [...container().querySelectorAll('.bureau-role')].map((node) => node.textContent);

describe('renderBureau', () => {
  it('shows a placeholder when nobody holds a role', () => {
    bureau.renderBureau([makeMember({ status: 'active' }), makeMember({ status: 'pending' })]);
    expect(container().textContent).toContain('Aucun membre du bureau défini');
    expect(container().querySelector('.bureau-card')).toBeNull();
  });

  it('shows a placeholder for an empty roster', () => {
    bureau.renderBureau([]);
    expect(container().textContent).toContain('Aucun membre du bureau défini');
  });

  it('lists only officers, in role order, with French role names', () => {
    bureau.renderBureau([
      makeMember({ status: 'treasurer' }), makeMember({ status: 'active' }), makeMember({ status: 'honorary_president' }),
      makeMember({ status: 'secretary' }), makeMember({ status: 'president' }), makeMember({ status: 'vice_president' }),
      makeMember({ status: 'honor' })
    ]);
    expect(roles()).toEqual([
      'Président', 'Vice-président', 'Secrétaire', 'Trésorier', "Président d'honneur"
    ]);
  });

  it('keeps several honorary presidents', () => {
    bureau.renderBureau([makeMember({ status: 'honorary_president' }), makeMember({ status: 'honorary_president' })]);
    expect(roles()).toEqual(["Président d'honneur", "Président d'honneur"]);
  });

  it('shows name and email link for each officer', () => {
    bureau.renderBureau([makeMember({ status: 'president', first_name: 'Ada', last_name: 'Lovelace', email: 'ada@x.fr' })]);
    expect(container().querySelector('.bureau-name').textContent).toBe('Ada Lovelace');
    const link = container().querySelector('.bureau-email a');
    expect(link.getAttribute('href')).toBe('mailto:ada@x.fr');
    expect(link.textContent).toBe('ada@x.fr');
  });

  it('offers an edit button carrying the member id, with no inline handler', () => {
    bureau.renderBureau([makeMember({ id: 12, status: 'secretary' })]);
    const button = container().querySelector('[data-action="edit-member"]');
    expect(button.dataset.memberId).toBe('12');
    expect(inlineHandlerAttributes(container())).toEqual([]);
  });

  it.each([
    ['a quote/tag breakout', XSS_ATTRIBUTE],
    ['apostrophes', XSS_APOSTROPHE],
    ['a script tag', '<script>alert(1)</script>']
  ])('escapes %s in names and emails', (_label, payload) => {
    bureau.renderBureau([makeMember({ status: 'president', first_name: payload, last_name: payload, email: `${payload}@x.fr` })]);

    expect(container().querySelector('img, script')).toBeNull();
    expect(inlineHandlerAttributes(container())).toEqual([]);
    expect(container().querySelector('.bureau-name').textContent).toBe(`${payload} ${payload}`);
    expect(container().querySelector('a').getAttribute('href')).toBe(`mailto:${payload}@x.fr`);
  });

  it('does not reorder or mutate the roster it is given', () => {
    const list = [makeMember({ id: 1, status: 'treasurer' }), makeMember({ id: 2, status: 'president' })];
    bureau.renderBureau(list);
    expect(list.map((m) => m.id)).toEqual([1, 2]);
  });

  it('loadBureau renders from the shared state', () => {
    state.members = [makeMember({ status: 'president' })];
    bureau.loadBureau();
    expect(container().querySelectorAll('.bureau-card')).toHaveLength(1);
  });
});
