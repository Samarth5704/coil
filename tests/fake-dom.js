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
    this._text = '';
    this.children.push(child);
    return child;
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
  return root;
}
