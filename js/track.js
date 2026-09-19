/* track.js — the recorded path of a hidden mover (`track/1`).
 *
 * The thing paper loses. Jack writes his route on a pad, the pad goes in the
 * box, and the best part of the game — "how on earth did you get from 47 to 12
 * without passing a constable?" — is gone. A track is that route, recorded as
 * it happens and exportable afterwards.
 *
 * A track has two faces, and the format keeps both:
 *   • the FULL track, for the reveal at the end
 *   • its PUBLIC projection — what opponents were legitimately entitled to see
 *     while it was being played (in Scotland Yard the transport is announced
 *     every turn, the station only on 3, 8, 13, 18 and 24)
 *
 * So positions are secret by default and `via` is public, and `reveal: true`
 * marks the moves where the mover surfaced. publicView() is the projection.
 *
 * Given a pack's `board.graph`, validate() re-walks a track and reports any
 * step that was not actually connected — which turns the export into a
 * post-game check as well as a souvenir.
 */
(function (global) {
  'use strict';

  const SCHEMA = 'track/1';
  const KEY = 'lfw:track:';

  const now = () => Date.now();
  const isNum = (v) => typeof v === 'number' && isFinite(v);

  function uid(prefix) {
    return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  /* ------------------------------------------------------------------ Track */

  class Track {
    constructor(meta) {
      meta = meta || {};
      this.schema = SCHEMA;
      this.id = meta.id || uid('trk_');
      this.pack = meta.pack || null;          // { id, name, ref }
      this.slot = meta.slot || null;          // the room code / save slot
      this.recorder = meta.recorder || null;  // { name, seat }
      this.started = isNum(meta.started) ? meta.started : now();
      this.ended = isNum(meta.ended) ? meta.ended : null;
      this.counters = meta.counters || { start: null, end: null };
      this.entries = Array.isArray(meta.entries) ? meta.entries.slice() : [];
    }

    get length() { return this.entries.length; }

    // moves are numbered among themselves, so "move 7" means the 7th step
    get moveCount() {
      return this.entries.filter((e) => e.e === 'move' || e.e === 'place').length;
    }

    add(entry) {
      if (!entry || !entry.e) return null;
      const e = Object.assign({ t: now() }, entry);
      if (e.e === 'move' || e.e === 'place') e.n = this.moveCount + 1;
      this.entries.push(e);
      return e;
    }

    move(o)    { return this.add(Object.assign({ e: 'move' }, o)); }
    place(o)   { return this.add(Object.assign({ e: 'place' }, o)); }
    remove(o)  { return this.add(Object.assign({ e: 'remove' }, o)); }
    counter(o) { return this.add(Object.assign({ e: 'counter' }, o)); }
    note(text) { return this.add({ e: 'note', text: String(text == null ? '' : text) }); }

    close(counters) {
      this.ended = now();
      if (counters) this.counters.end = counters;
      return this;
    }

    toJSON() {
      return {
        schema: SCHEMA,
        id: this.id,
        pack: this.pack,
        slot: this.slot,
        recorder: this.recorder,
        started: this.started,
        ended: this.ended,
        counters: this.counters,
        entries: this.entries,
      };
    }

    toText() { return JSON.stringify(this.toJSON(), null, 1); }

    /* What opponents were entitled to see. Positions vanish unless the mover
     * surfaced on that move; `via` and every non-positional event stay. */
    publicView() {
      const out = new Track(Object.assign(this.toJSON(), { entries: [] }));
      out.entries = this.entries.map((e) => {
        if (e.e !== 'move' && e.e !== 'place') return Object.assign({}, e);
        const c = Object.assign({}, e);
        if (!e.reveal) { delete c.node; delete c.x; delete c.y; c.hidden = true; }
        return c;
      });
      return out;
    }

    filename() {
      const packId = (this.pack && this.pack.id) || 'track';
      const when = new Date(this.started).toISOString().slice(0, 16).replace(/[:T]/g, '-');
      return `${packId}-${when}.track.json`;
    }
  }

  /* ---------------------------------------------------------------- parsing */

  // Accepts an object or a JSON string. Throws on anything that isn't a track —
  // imported files are untrusted, so the shape is checked before it is used.
  function parse(input) {
    const raw = (typeof input === 'string') ? JSON.parse(input) : input;
    if (!raw || typeof raw !== 'object') throw new Error('Track is not an object');
    if (raw.schema !== SCHEMA) throw new Error('Unsupported track schema: ' + raw.schema);
    if (!Array.isArray(raw.entries)) throw new Error('Track has no entries array');
    const entries = raw.entries.filter((e) => e && typeof e === 'object' && typeof e.e === 'string');
    return new Track(Object.assign({}, raw, { entries }));
  }

  /* ------------------------------------------------------- graph validation */

  // Build an undirected adjacency index from a pack's board.graph.
  function indexGraph(graph) {
    const adj = new Map();                    // node -> Map(neighbour -> Set(kind))
    const link = (a, b, kind) => {
      if (!adj.has(a)) adj.set(a, new Map());
      const to = adj.get(a);
      if (!to.has(b)) to.set(b, new Set());
      if (kind) to.get(b).add(kind);
    };
    ((graph && graph.edges) || []).forEach((e) => {
      if (!Array.isArray(e) || e.length < 2) return;
      const [a, b, kind] = [String(e[0]), String(e[1]), e[2] ? String(e[2]) : null];
      link(a, b, kind); link(b, a, kind);
    });
    return adj;
  }

  function connected(adj, a, b, kind) {
    const to = adj.get(String(a));
    if (!to || !to.has(String(b))) return false;
    if (!kind) return true;
    const kinds = to.get(String(b));
    return kinds.size === 0 || kinds.has(String(kind));
  }

  /* Re-walk a track over a pack's graph. Returns { ok, checked, problems[] }.
   * Only node-based moves can be checked — a free-drag board has no notion of
   * a connection, so those steps are reported as skipped rather than illegal. */
  function validate(track, graph) {
    const t = (track instanceof Track) ? track : parse(track);
    const adj = indexGraph(graph);
    const problems = [];
    let checked = 0;
    const last = new Map();                   // piece -> previous node

    t.entries.forEach((e) => {
      if (e.e !== 'move' && e.e !== 'place') return;
      const piece = e.piece || 'piece';
      if (e.node == null) { last.delete(piece); return; }   // free-drag step: unknowable
      const node = String(e.node);
      const prev = last.get(piece);
      if (e.e === 'move' && prev != null) {
        checked++;
        if (!adj.has(node) && !adj.has(prev)) {
          problems.push({ n: e.n, piece, from: prev, to: node, why: 'node not in graph' });
        } else if (!connected(adj, prev, node, e.via)) {
          problems.push({
            n: e.n, piece, from: prev, to: node, via: e.via || null,
            why: e.via ? 'no ' + e.via + ' connection' : 'not connected',
          });
        }
      }
      last.set(piece, node);
    });

    return { ok: problems.length === 0, checked, problems };
  }

  /* -------------------------------------------------------------- recording */

  /* Holds the live track for one table and mirrors it to localStorage, so a
   * refresh mid-game does not lose the route. Keyed like counters: room + pack. */
  class TrackRecorder {
    constructor(opts) {
      opts = opts || {};
      this.slot = opts.slot || 'default';
      this.recorder = opts.recorder || null;
      this.enabled = false;
      this.def = null;
      this.track = null;
    }

    key() { return KEY + this.slot + ':' + ((this.def && this.def.id) || 'untitled'); }

    setDef(def, counters) {
      this.def = def;
      this.enabled = !!(def && def.track);
      if (!this.enabled) { this.track = null; return; }
      this.track = this._load() || new Track({
        slot: this.slot,
        recorder: this.recorder,
        pack: def ? { id: def.id, name: def.name, ref: def.source && def.source.ref } : null,
        counters: { start: counters || null, end: null },
      });
      this._save();
    }

    _load() {
      try {
        const raw = localStorage.getItem(this.key());
        if (!raw) return null;
        const t = parse(raw);
        return (t.pack && this.def && t.pack.id === this.def.id) ? t : null;
      } catch (e) { return null; }           // unreadable or foreign: start fresh
    }

    _save() {
      if (!this.track) return;
      try { localStorage.setItem(this.key(), this.track.toText()); }
      catch (e) { /* storage blocked: the track still lives for this session */ }
    }

    record(kind, payload) {
      if (!this.enabled || !this.track) return null;
      const fn = this.track[kind];
      if (typeof fn !== 'function') return null;
      const e = fn.call(this.track, payload);
      this._save();
      return e;
    }

    reset(counters) {
      if (!this.enabled) return;
      this.track = new Track({
        slot: this.slot,
        recorder: this.recorder,
        pack: this.def ? { id: this.def.id, name: this.def.name } : null,
        counters: { start: counters || null, end: null },
      });
      this._save();
    }
  }

  /* --------------------------------------------------------------- download */

  // Offer a track as a file. Kept here so the UI layer never builds Blobs.
  function download(track, opts) {
    const t = (track instanceof Track) ? track : parse(track);
    const body = (opts && opts.publicOnly) ? t.publicView() : t;
    const blob = new Blob([body.toText()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (opts && opts.filename) || t.filename();
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return a.download;
  }

  const API = { SCHEMA, Track, TrackRecorder, parse, validate, indexGraph, download };
  global.TrackFmt = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
