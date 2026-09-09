// Coil — the readout.
//
// DOM, and only DOM: it is handed strings that someone else derived and it
// writes them onto nodes that already exist in index.html.
//
// It never builds markup and it never assigns innerHTML. The readout updates
// as often as seven times a second; rebuilding it at that rate would destroy
// focus and selection on every frame and thrash layout for a panel whose
// content is six short strings. The nodes are found once, keyed by
// data-field, and written through textContent forever after.
//
// This is also the panel that makes the game legible at all. The ramp steps
// sit at 1.12:1 against each other, so the reachable count, the multiplier and
// the ramp step BY NAME live here as real text, available without the canvas.

// The keyed value nodes, in the order they read. A field named here and
// missing from the markup is a mistake worth throwing over: a readout that
// silently drops the multiplier looks fine and says nothing.
const FIELDS = ['score', 'highScore', 'reachable', 'multiplier', 'ramp', 'length'];

function requireNode(root, field) {
  const node = root.querySelector(`[data-field="${field}"]`);
  if (!node) {
    throw new Error(`readout: no node with data-field="${field}" under the root element`);
  }
  return node;
}

export function createReadout({ root } = {}) {
  if (!root || typeof root.querySelector !== 'function') {
    throw new TypeError('createReadout needs a root element to look its nodes up in');
  }

  // Looked up once. Every later update is a textContent write on these exact
  // objects, which is what keeps node identity stable across renders.
  const nodes = {};
  for (const field of FIELDS) nodes[field] = requireNode(root, field);
  const summaryNode = requireNode(root, 'summary');
  const hintNode = requireNode(root, 'hint');

  // Last value written per field, so an unchanged string is not written again.
  // An untouched text node is one the browser does not re-lay-out and one a
  // screen reader does not re-read.
  const written = {};

  function update(strings) {
    for (const field of Object.keys(strings)) {
      if (!Object.prototype.hasOwnProperty.call(nodes, field)) {
        throw new Error(`readout: no field named "${field}"; expected one of ${FIELDS.join(', ')}`);
      }
    }
    for (const field of FIELDS) {
      const value = strings[field];
      if (value === undefined || written[field] === value) continue;
      written[field] = value;
      nodes[field].textContent = value;
    }
  }

  // The visually hidden line a screen reader finds when a run ends. Not a live
  // region: it is written once, at the transition, and read on demand.
  function setSummary(text) {
    const value = text === null || text === undefined ? '' : String(text);
    if (written.summary === value) return;
    written.summary = value;
    summaryNode.textContent = value;
  }

  // One honest line, or nothing. Hidden by the hidden attribute rather than by
  // emptying it, so it is out of the accessibility tree as well as out of
  // sight when there is nothing to say.
  function setHint(text) {
    if (text === null || text === undefined || text === '') {
      hintNode.textContent = '';
      hintNode.setAttribute('hidden', '');
      written.hint = '';
      return;
    }
    const value = String(text);
    if (written.hint !== value) {
      written.hint = value;
      hintNode.textContent = value;
    }
    hintNode.removeAttribute('hidden');
  }

  return { update, setSummary, setHint, nodes, fields: FIELDS };
}
