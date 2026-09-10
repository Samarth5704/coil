// A hand-rolled stand-in for the two DOM operations the readout performs:
// finding a keyed node once, and writing textContent to it forever after.
//
// There is no jsdom here on purpose — the project has zero runtime
// dependencies and vitest is the only dev one, so a DOM for a test that reads
// five text nodes is written rather than installed. It implements exactly what
// src/ui/readout.js touches and nothing else.
//
// `innerHTML` is implemented as the destructive thing it is: assigning to it
// throws away every child object and parses fresh ones. That is what makes the
// node-identity assertion in readout.test.js a real test rather than a
// tautology — reconciling keeps the same object, rebuilding cannot.

export class FakeElement {
  constructor(tagName = 'div', attributes = {}) {
    this.tagName = tagName.toUpperCase();
    this.attributes = { ...attributes };
    this.children = [];
    this.parentNode = null;
    this.ownerDocument = null;
    this.listeners = {};
    this._text = '';
  }

  get textContent() {
    if (this.children.length === 0) return this._text;
    return this.children.map((child) => child.textContent).join('');
  }

  set textContent(value) {
    for (const child of this.children) child.parentNode = null;
    this.children = [];
    this._text = String(value);
  }

  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name)
      ? this.attributes[name]
      : null;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  removeAttribute(name) {
    delete this.attributes[name];
  }

  appendChild(child) {
    child.parentNode = this;
    if (child.ownerDocument === null) child.ownerDocument = this.ownerDocument;
    this._text = '';
    this.children.push(child);
    return child;
  }

  addEventListener(type, handler) {
    (this.listeners[type] ||= []).push(handler);
  }

  removeEventListener(type, handler) {
    this.listeners[type] = (this.listeners[type] || []).filter((h) => h !== handler);
  }

  dispatchEvent(event) {
    for (const handler of [...(this.listeners[event.type] || [])]) {
      handler({ target: this, ...event });
    }
    return true;
  }

  click() {
    return this.dispatchEvent({ type: 'click' });
  }

  focus() {
    if (this.ownerDocument) this.ownerDocument.activeElement = this;
  }

  // Supports `[data-field="score"]`, `[hidden]` and a bare tag name. That is
  // the whole selector language src/ui/readout.js uses.
  querySelector(selector) {
    for (const child of this.children) {
      if (matches(child, selector)) return child;
      const found = child.querySelector(selector);
      if (found) return found;
    }
    return null;
  }

  querySelectorAll(selector) {
    const out = [];
    for (const child of this.children) {
      if (matches(child, selector)) out.push(child);
      out.push(...child.querySelectorAll(selector));
    }
    return out;
  }

  // Deliberately destructive, exactly like the real thing.
  set innerHTML(html) {
    for (const child of this.children) child.parentNode = null;
    this.children = [];
    this._text = '';
    const tag = /<(\w+)([^>]*)>([^<]*)<\/\1>/g;
    let match;
    let consumed = 0;
    while ((match = tag.exec(String(html))) !== null) {
      const element = new FakeElement(match[1], parseAttributes(match[2]));
      element.textContent = match[3];
      this.appendChild(element);
      consumed = tag.lastIndex;
    }
    if (consumed === 0) this._text = String(html);
  }

  get innerHTML() {
    if (this.children.length === 0) return this._text;
    return this.children
      .map((c) => `<${c.tagName.toLowerCase()}>${c.innerHTML}</${c.tagName.toLowerCase()}>`)
      .join('');
  }
}

function parseAttributes(source) {
  const attributes = {};
  for (const match of source.matchAll(/([\w-]+)\s*=\s*"([^"]*)"/g)) {
    attributes[match[1]] = match[2];
  }
  return attributes;
}

function matches(element, selector) {
  const attribute = selector.match(/^\[([\w-]+)(?:="([^"]*)")?\]$/);
  if (attribute) {
    const value = element.getAttribute(attribute[1]);
    if (value === null) return false;
    return attribute[2] === undefined || value === attribute[2];
  }
  return element.tagName === selector.toUpperCase();
}

// The readout's markup, built as objects so a test does not have to parse
// index.html. Mirrors the keyed nodes index.html ships.
export function readoutMarkup() {
  const root = new FakeElement('div', { class: 'readout' });
  for (const field of ['score', 'highScore', 'reachable', 'multiplier', 'ramp', 'length']) {
    const row = new FakeElement('div', { class: 'readout-row' });
    row.appendChild(new FakeElement('dt')).textContent = field;
    const value = new FakeElement('dd', { 'data-field': field });
    value.textContent = '—';
    row.appendChild(value);
    root.appendChild(row);
  }
  root.appendChild(new FakeElement('p', { 'data-field': 'summary', class: 'visually-hidden' }));
  root.appendChild(new FakeElement('p', { 'data-field': 'hint', hidden: '' }));
  // The second honest line: iOS and the ringer switch. Its own node, as in
  // index.html, because either hint can be showing without the other.
  root.appendChild(new FakeElement('p', { 'data-field': 'ringer', hidden: '' }));
  return root;
}

// ---------------------------------------------------------------------------
// Phase 6 additions.
//
// Input, the game-over state and the settings panel need four things phase 5's
// readout never touched: creating an element, listening for an event, moving
// focus, and reading it back. `activeElement` is the whole reason this exists
// rather than a spy — "focus landed on the restart button" and "focus fell
// through to <body>" are the same call from the outside and different states
// here, and only the second one is the bug.

export class FakeDocument {
  constructor() {
    this.body = new FakeElement('body');
    this.body.ownerDocument = this;
    // A document with nothing focused focuses its body, exactly like the real
    // one. A test that finds this at the end of a death is looking at the bug.
    this.activeElement = this.body;
  }

  createElement(tagName) {
    const element = new FakeElement(tagName);
    element.ownerDocument = this;
    return element;
  }

  querySelector(selector) {
    return this.body.querySelector(selector);
  }

  querySelectorAll(selector) {
    return this.body.querySelectorAll(selector);
  }
}

// A plain event object, enough for the handlers under test: a type, a key, the
// repeat flag a held key sets, and a preventDefault that records the call
// rather than doing anything.
export function fakeEvent(type, fields = {}) {
  const event = { type, defaultPrevented: false, ...fields };
  event.preventDefault = () => { event.defaultPrevented = true; };
  return event;
}

export function keydown(key, fields = {}) {
  return fakeEvent('keydown', { key, repeat: false, ...fields });
}

// The idle instruction, taken from the one place it is written, so the fixture
// cannot drift from the page the way two copies of a sentence do.
import { IDLE_INSTRUCTION } from '../src/render/labels.js';

// The panel markup index.html ships, built as objects: the readout's keyed
// nodes, the game-over region with its summary and its restart button, and the
// settings controls. Kept in one place so a test wires the same nodes main.js
// wires, and built into a FakeDocument so focus has somewhere to land.
export function appMarkup() {
  const doc = new FakeDocument();
  const panel = doc.createElement('div');
  panel.setAttribute('class', 'panel');
  doc.body.appendChild(panel);

  const readout = readoutMarkup();
  // readoutMarkup owns the summary and hint nodes; the game-over region and
  // the settings block below are where index.html actually puts them, so they
  // are moved rather than duplicated. One node, one owner.
  const summary = readout.querySelector('[data-field="summary"]');
  const hint = readout.querySelector('[data-field="hint"]');
  const ringer = readout.querySelector('[data-field="ringer"]');
  readout.children = readout.children.filter(
    (c) => c !== summary && c !== hint && c !== ringer,
  );
  panel.appendChild(readout);

  const idle = doc.createElement('p');
  idle.setAttribute('data-role', 'idle');
  idle.textContent = IDLE_INSTRUCTION;
  panel.appendChild(idle);

  const region = doc.createElement('div');
  region.setAttribute('data-role', 'gameover');
  region.setAttribute('hidden', '');
  region.appendChild(summary);
  const restart = doc.createElement('button');
  restart.setAttribute('type', 'button');
  restart.setAttribute('data-role', 'restart');
  restart.setAttribute('aria-label', 'Start a new run');
  restart.textContent = 'New run';
  region.appendChild(restart);
  panel.appendChild(region);

  const settings = doc.createElement('div');
  settings.setAttribute('data-role', 'settings');
  for (const name of ['sound', 'stepMode']) {
    const input = doc.createElement('input');
    input.setAttribute('type', 'checkbox');
    input.setAttribute('data-setting', name);
    input.checked = false;
    settings.appendChild(input);
  }
  const select = doc.createElement('select');
  select.setAttribute('data-setting', 'reducedMotion');
  select.value = 'system';
  settings.appendChild(select);
  settings.appendChild(hint);
  settings.appendChild(ringer);
  panel.appendChild(settings);

  const dpad = doc.createElement('div');
  dpad.setAttribute('data-role', 'dpad');
  panel.appendChild(dpad);

  return { doc, panel, readout, idle, region, restart, settings, dpad };
}
