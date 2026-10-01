/* global document */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { bindDelegation } from '../../src/client/admin/actions.js';
import { isolateDocumentListeners, click, change } from './helpers.js';

isolateDocumentListeners();

let actions;
let changes;

beforeEach(() => {
  actions = { 'do-it': vi.fn(), 'other': vi.fn() };
  changes = { 'on-change': vi.fn() };
  bindDelegation(actions, changes);
});

describe('click delegation', () => {
  it('calls the action with the data-action element and the event', () => {
    document.body.innerHTML = '<button id="b" data-action="do-it" data-member-id="4">Go</button>';
    const button = document.getElementById('b');

    const event = click(button);

    expect(actions['do-it']).toHaveBeenCalledTimes(1);
    const [element, receivedEvent] = actions['do-it'].mock.calls[0];
    expect(element).toBe(button);
    expect(element.dataset.memberId).toBe('4');
    expect(receivedEvent).toBe(event);
  });

  it('resolves clicks on nested elements to the closest data-action ancestor', () => {
    document.body.innerHTML = '<button id="b" data-action="do-it"><span><strong id="deep">Go</strong></span></button>';

    click(document.getElementById('deep'));

    expect(actions['do-it']).toHaveBeenCalledTimes(1);
    expect(actions['do-it'].mock.calls[0][0]).toBe(document.getElementById('b'));
  });

  it('uses the innermost data-action when actions are nested', () => {
    document.body.innerHTML = '<div data-action="other"><button id="inner" data-action="do-it">x</button></div>';

    click(document.getElementById('inner'));

    expect(actions['do-it']).toHaveBeenCalledTimes(1);
    expect(actions.other).not.toHaveBeenCalled();
  });

  it('prevents the default action for handled clicks', () => {
    document.body.innerHTML = '<a id="a" href="#x" data-action="do-it">link</a>';
    expect(click(document.getElementById('a')).defaultPrevented).toBe(true);
  });

  it('ignores clicks outside any data-action element', () => {
    document.body.innerHTML = '<button id="b">plain</button>';
    const event = click(document.getElementById('b'));
    expect(actions['do-it']).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('ignores unknown action names without preventing the default', () => {
    document.body.innerHTML = '<button id="b" data-action="nope">x</button>';
    const event = click(document.getElementById('b'));
    expect(event.defaultPrevented).toBe(false);
  });

  it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])(
    'does not treat inherited Object member "%s" as an action',
    (name) => {
      document.body.innerHTML = `<button id="b" data-action="${name}">x</button>`;
      const event = click(document.getElementById('b'));
      expect(event.defaultPrevented).toBe(false);
    }
  );

  it.each(['constructor', '__proto__', 'toString'])('does not treat inherited Object member "%s" as a change handler', (name) => {
    document.body.innerHTML = `<input id="c" data-change="${name}">`;
    expect(() => change(document.getElementById('c'))).not.toThrow();
  });

  it('handles elements added after binding (delegation)', () => {
    document.body.innerHTML = '';
    const late = document.createElement('button');
    late.dataset.action = 'other';
    document.body.append(late);
    click(late);
    expect(actions.other).toHaveBeenCalledTimes(1);
  });
});

describe('change delegation', () => {
  it('calls the change handler with the data-change element', () => {
    document.body.innerHTML = '<input id="c" type="checkbox" data-change="on-change" data-member-id="9">';
    const input = document.getElementById('c');

    change(input);

    expect(changes['on-change']).toHaveBeenCalledTimes(1);
    expect(changes['on-change'].mock.calls[0][0]).toBe(input);
  });

  it('resolves changes on nested elements', () => {
    document.body.innerHTML = '<label data-change="on-change"><input id="deep" type="checkbox"></label>';
    change(document.getElementById('deep'));
    expect(changes['on-change']).toHaveBeenCalledTimes(1);
  });

  it('ignores elements without data-change and unknown names', () => {
    document.body.innerHTML = '<input id="a"><input id="b" data-change="nope">';
    expect(() => {
      change(document.getElementById('a'));
      change(document.getElementById('b'));
    }).not.toThrow();
    expect(changes['on-change']).not.toHaveBeenCalled();
  });
});
