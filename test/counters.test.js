/* Node self-test for js/counters.js — run:  node test/counters.test.js
 *
 * Counters are the one piece of pack state that is deliberately NOT shared, so
 * the things worth proving are the local ones: clamping, persistence scoped to
 * room + pack, and surviving a browser that refuses localStorage.
 *
 * No jsdom here (this repo has no dependencies) — just enough DOM to let
 * _render() run.
 */
'use strict';
const assert = require('assert');

/* ---------------- the smallest DOM that makes _render() work -------------- */
class El {
  constructor(tag) {
    this.tag = tag; this.children = []; this.style = {}; this.attrs = {};
    this._cls = new Set(); this.textContent = ''; this.disabled = false;
  }
  set className(v) { this._cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get className() { return [...this._cls].join(' '); }
  get classList() {
    const c = this._cls;
    return {
      add: (x) => c.add(x),
      remove: (x) => c.delete(x),
      contains: (x) => c.has(x),
      toggle: (x, on) => (on === undefined ? (c.has(x) ? c.delete(x) : c.add(x)) : (on ? c.add(x) : c.delete(x))),
    };
  }
  get firstChild() { return this.children[0] || null; }
  appendChild(n) { this.children.push(n); return n; }
  removeChild(n) { this.children = this.children.filter((c) => c !== n); return n; }
  setAttribute(k, v) { this.attrs[k] = v; }
  // depth-first walk, used by the assertions below
  find(pred) {
    if (pred(this)) return this;
    for (const c of this.children) { const hit = c.find && c.find(pred); if (hit) return hit; }
    return null;
  }
  findAll(pred, out = []) {
    if (pred(this)) out.push(this);
    this.children.forEach((c) => c.findAll && c.findAll(pred, out));
    return out;
  }
}

function makeStorage(broken) {
  const map = new Map();
  return {
    map,
    getItem(k) { if (broken) throw new Error('denied'); return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { if (broken) throw new Error('denied'); map.set(k, String(v)); },
  };
}

function install(storage) {
  globalThis.document = { createElement: (t) => new El(t) };
  globalThis.localStorage = storage;
}

install(makeStorage(false));
const CounterTray = require('../js/counters.js');

/* ---------------- harness (mirrors rules.test.js) ------------------------- */
let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; return; }
  failed++; console.error('  FAIL  ' + name);
}

/* normalised counters, as gamedef.js would hand them over */
const C = (over) => Object.assign(
  { id: 'c', label: 'C', glyph: null, start: 0, min: 0, max: null, step: 1, color: null }, over);

const defOf = (counters, id) => ({ id: id || 'pack', counters });

function trayFor(counters, slot, id) {
  const tray = new El('div');
  const t = new CounterTray({ tray }, { slot: slot || 'room1' });
  t.setDef(defOf(counters, id));
  return { t, tray };
}
const valueTexts = (tray) => tray.findAll((e) => e._cls.has('counter-value')).map((e) => e.textContent);

/* ---------------- 1. starting values ------------------------------------- */
{
  const { t, tray } = trayFor([C({ id: 'taxi', start: 4 }), C({ id: 'black', start: 5, max: 5 })]);
  ok('starts from the pack values', t.values.taxi === 4 && t.values.black === 5);
  ok('renders one chip per counter', tray.findAll((e) => e._cls.has('counter')).length === 2);
  ok('shows the values', valueTexts(tray).join(',') === '4,5');
  ok('tray is visible', !tray.classList.contains('hidden'));
}

/* ---------------- 2. clamping -------------------------------------------- */
{
  const { t } = trayFor([C({ id: 'a', start: -9 }), C({ id: 'b', start: 99, max: 4 }), C({ id: 'n', start: 0, min: 1, max: 4 })]);
  ok('start clamped up to min', t.values.a === 0);
  ok('start clamped down to max', t.values.b === 4);
  ok('start honours an explicit min', t.values.n === 1);
}

/* ---------------- 3. bump respects bounds and step ------------------------ */
{
  const c = C({ id: 'taxi', start: 2, max: 3 });
  const { t } = trayFor([c]);
  t.bump(c, +1); ok('bump up', t.values.taxi === 3);
  t.bump(c, +1); ok('stops at max', t.values.taxi === 3);
  t.bump(c, -1); t.bump(c, -1); t.bump(c, -1);
  ok('stops at min', t.values.taxi === 0);

  const s = C({ id: 's', start: 0, step: 5, max: 20 });
  const two = trayFor([s]);
  two.t.bump(s, +1);
  ok('step is honoured', two.t.values.s === 5);
}

/* ---------------- 4. bounds disable the buttons -------------------------- */
{
  const { tray } = trayFor([C({ id: 'z', start: 0, max: 0 })]);
  const btns = tray.findAll((e) => e._cls.has('counter-btn'));
  ok('both buttons disabled at a pinned bound', btns.length === 2 && btns[0].disabled && btns[1].disabled);
}

/* ---------------- 5. persistence, scoped to room + pack ------------------ */
{
  const c = C({ id: 'taxi', start: 4 });
  const a = trayFor([c], 'roomA', 'sy');
  a.t.bump(c, -1); a.t.bump(c, -1);
  ok('value changed', a.t.values.taxi === 2);

  const reopened = trayFor([C({ id: 'taxi', start: 4 })], 'roomA', 'sy');
  ok('reloads the stored value', reopened.t.values.taxi === 2);

  const otherRoom = trayFor([C({ id: 'taxi', start: 4 })], 'roomB', 'sy');
  ok('a different room is a separate slot', otherRoom.t.values.taxi === 4);

  const otherPack = trayFor([C({ id: 'taxi', start: 4 })], 'roomA', 'whitechapel');
  ok('a different pack is a separate slot', otherPack.t.values.taxi === 4);
}

/* ---------------- 6. reset ------------------------------------------------ */
{
  const c = C({ id: 'k', start: 3 });
  const { t } = trayFor([c], 'resetRoom');
  t.bump(c, -1); t.bump(c, -1);
  ok('moved off start', t.values.k === 1);
  t.resetAll();
  ok('reset restores start', t.values.k === 3);
  const again = trayFor([C({ id: 'k', start: 3 })], 'resetRoom');
  ok('reset is persisted', again.t.values.k === 3);
}

/* ---------------- 7. a pack with no counters shows nothing ---------------- */
{
  const { tray } = trayFor([]);
  ok('tray hidden when the pack declares none', tray.classList.contains('hidden'));
  ok('tray emptied', tray.children.length === 0);
}

/* ---------------- 8. storage refusing (private browsing) ----------------- */
{
  install(makeStorage(true));
  const c = C({ id: 'taxi', start: 4 });
  const tray = new El('div');
  const t = new CounterTray({ tray }, { slot: 'r' });
  let threw = false;
  try { t.setDef(defOf([c])); t.bump(c, -1); } catch (e) { threw = true; }
  ok('survives localStorage throwing', !threw && t.values.taxi === 3);
  install(makeStorage(false));
}

/* ---------------- 9. PrivateNet must cover Net's whole surface ------------ */
{
  const fs = require('fs'), path = require('path');
  const netSrc = fs.readFileSync(path.join(__dirname, '../js/net.js'), 'utf8');
  const body = netSrc.slice(netSrc.indexOf('class Net'));
  const methods = new Set();
  const re = /^\s{4}([a-zA-Z][a-zA-Z0-9_]*)\s*\(/gm;
  let m;
  while ((m = re.exec(body))) if (!['if', 'for', 'while', 'switch', 'catch'].includes(m[1])) methods.add(m[1]);

  const PrivateNet = require('../js/privatenet.js');
  const proto = PrivateNet.prototype;
  const missing = [...methods].filter((k) => k !== 'constructor' && k.charAt(0) !== '_' && typeof proto[k] !== 'function');
  ok('PrivateNet implements every public Net method (missing: ' + missing.join(', ') + ')', missing.length === 0);

  const p = new PrivateNet('r', { id: 'i', name: 'n' }, {});
  let status = null;
  p.handlers.onStatus = (s) => { status = s; };
  p.connect();
  ok('connect reports the private status', status === 'private');
  ok('publishing is a silent no-op', p.publishMarker({ id: 'm' }) === undefined && p.client === null);
}

console.log(failed
  ? `counters.test.js: ${passed} passed, ${failed} FAILED`
  : `counters.test.js: ${passed} passed`);
process.exit(failed ? 1 : 0);
