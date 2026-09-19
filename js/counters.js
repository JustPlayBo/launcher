/* counters.js — the things a player holds rather than places (boardgame/1.4).
 *
 * A pack can declare `counters`: small +/− trackers for Mr X's tickets, Jack's
 * carriage moves, a blood pool, a night number. They are the other half of a
 * hidden-movement companion — the pieces say where you are, the counters say
 * what you have left.
 *
 * Deliberately NOT synced. A counter is your own supply, and in a companion for
 * a hidden-movement game it is exactly the state nobody else may see. Values
 * live in localStorage keyed by room + pack, so a refresh keeps them and two
 * packs never tread on each other.
 *
 * Pack strings come from untrusted URLs, so the DOM is built with createElement
 * + textContent throughout. We never assign pack text to innerHTML.
 */
(function (global) {
  'use strict';

  const KEY = 'lfw:counters:';

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  class CounterTray {
    constructor(refs, opts) {
      this.refs = refs;                                  // { tray }
      this.slot = (opts && opts.slot) || 'default';      // the room code, as a save slot
      this.onAids = (opts && opts.onAids) || function () {};
      this.toast = (opts && opts.toast) || function () {};
      this.onChange = (opts && opts.onChange) || function () {};   // (counter, from, to)
      this.def = null;
      this.counters = [];
      this.values = {};
    }

    /* ---------- called by app.js when the pack changes ---------- */
    setDef(def) {
      this.def = def;
      this.counters = (def && def.counters) || [];
      this.values = this._load();
      this._render();
    }

    _key() {
      return KEY + this.slot + ':' + ((this.def && this.def.id) || 'untitled');
    }

    // Start from the pack's declared values, then let anything stored win.
    _load() {
      const out = {};
      // clamp the pack's own start too: normalisation does this, but a def built
      // by hand (or by an older gamedef.js) may still hand us an out-of-range one.
      this.counters.forEach((c) => { out[c.id] = this._clamp(c, c.start); });
      let raw = null;
      try { raw = JSON.parse(localStorage.getItem(this._key()) || '{}'); }
      catch (e) { raw = null; }             // private browsing, or corrupt — use the starts
      if (raw && typeof raw === 'object') {
        this.counters.forEach((c) => {
          const v = Number(raw[c.id]);
          if (Number.isFinite(v)) out[c.id] = this._clamp(c, v);
        });
      }
      return out;
    }

    _save() {
      try { localStorage.setItem(this._key(), JSON.stringify(this.values)); }
      catch (e) { /* storage blocked: counters still work for this session */ }
    }

    _clamp(c, v) {
      let n = Math.round(Number(v) || 0);
      if (c.min != null) n = Math.max(c.min, n);
      if (c.max != null) n = Math.min(c.max, n);
      return n;
    }

    bump(c, delta) {
      const from = this.values[c.id] || 0;
      const next = this._clamp(c, from + delta * c.step);
      if (next === from) return;                         // already at a bound
      this.values[c.id] = next;
      this._save();
      this._render();
      this.onChange(c, from, next);
    }

    /* A snapshot of every current value — what a track records at start and end. */
    snapshot() { return Object.assign({}, this.values); }

    resetAll() {
      this.counters.forEach((c) => { this.values[c.id] = c.start; });
      this._save();
      this._render();
      this.toast('Counters reset');
    }

    _render() {
      const tray = this.refs.tray;
      if (!tray) return;
      while (tray.firstChild) tray.removeChild(tray.firstChild);

      const show = this.counters.length > 0;
      tray.classList.toggle('hidden', !show);
      if (show) {
        this.counters.forEach((c) => tray.appendChild(this._chip(c)));
        const reset = el('button', 'counter-reset', '↺');
        reset.type = 'button';
        reset.title = 'Reset every counter to its starting value';
        reset.setAttribute('aria-label', 'Reset counters');
        reset.onclick = () => this.resetAll();
        tray.appendChild(reset);
      }
      this.onAids();
    }

    _chip(c) {
      const wrap = el('div', 'counter');
      if (c.color) wrap.style.borderColor = c.color;

      const label = el('span', 'counter-label');
      if (c.glyph) label.appendChild(el('span', 'counter-glyph', c.glyph));
      label.appendChild(el('span', 'counter-name', c.label));
      wrap.appendChild(label);

      const value = el('span', 'counter-value', String(this.values[c.id]));

      const minus = el('button', 'counter-btn', '−');
      minus.type = 'button';
      minus.setAttribute('aria-label', 'One fewer ' + c.label);
      minus.onclick = () => this.bump(c, -1);
      minus.disabled = c.min != null && this.values[c.id] <= c.min;

      const plus = el('button', 'counter-btn', '+');
      plus.type = 'button';
      plus.setAttribute('aria-label', 'One more ' + c.label);
      plus.onclick = () => this.bump(c, +1);
      plus.disabled = c.max != null && this.values[c.id] >= c.max;

      wrap.appendChild(minus);
      wrap.appendChild(value);
      wrap.appendChild(plus);
      return wrap;
    }
  }

  global.CounterTray = CounterTray;
  if (typeof module !== 'undefined' && module.exports) module.exports = CounterTray;
})(typeof window !== 'undefined' ? window : globalThis);
