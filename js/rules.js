/* rules.js — the OPTIONAL rule-enforcement engine (boardgame/1.3).
 *
 * The base engine is a free table: it enforces nothing. A pack can opt in by
 * declaring a `logic` block, and then THIS module turns moves into legal/illegal
 * verdicts and detects wins/draws. Packs with no `logic` are untouched.
 *
 *   "logic": {
 *     "enforce": "strict",                       // "strict" (default) | "advisory"
 *     "grid": { "cols": 3, "rows": 3, "snap": true, "gravity": "down" },
 *     "turns": { "auto": true },                 // auto-advance after a legal move
 *     "own": { "x": "X", "o": "O" },             // piece.type -> player (supports "w*")
 *     "place": { "legal": "cell.empty && piece.owner == turn", "reason": "…" },
 *     "move":  { "legal": "false" },
 *     "remove":{ "legal": "false" },
 *     "win":   [ { "when": "line(3)", "result": "{player} wins!" } ],
 *     "draw":  [ { "when": "full()", "result": "It's a draw." } ]
 *   }
 *
 * Players come from the EXISTING `def.turns.players` (the shared turn chip), so
 * `turn` in an expression is the current seat's name.
 *
 * ── Security ──────────────────────────────────────────────────────────────
 * Packs are loaded from arbitrary URLs and shared over a public MQTT broker, so
 * the expression language is a hand-written sandbox: a tokenizer + Pratt parser
 * + tree-walking evaluator. There is NO eval()/new Function(), no access to any
 * JS global, and property reads are guarded against __proto__/constructor. An
 * expression can only read the variables and call the functions the engine hands
 * it. The worst a hostile expression can do is be wrong.
 *
 * Pure & deterministic: every peer runs the same engine over the same board and
 * reaches the same verdict, which is what keeps a last-writer-wins table honest.
 */
(function (global) {
  'use strict';

  /* =========================================================================
   * 1. The expression DSL — tokenizer / parser / evaluator
   * ========================================================================= */

  const PUNCT = ['==', '!=', '<=', '>=', '&&', '||', '<', '>', '!', '+', '-',
    '*', '/', '%', '(', ')', ',', '.', '='];

  function tokenize(src) {
    const toks = [];
    let i = 0;
    const n = src.length;
    while (i < n) {
      const c = src[i];
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
      // string literal
      if (c === '"' || c === "'") {
        const quote = c; let j = i + 1, s = '';
        while (j < n && src[j] !== quote) {
          if (src[j] === '\\' && j + 1 < n) { s += src[j + 1]; j += 2; }
          else { s += src[j]; j++; }
        }
        if (j >= n) throw new Error('Unterminated string in expression');
        toks.push({ t: 'str', v: s }); i = j + 1; continue;
      }
      // number
      if (c >= '0' && c <= '9') {
        let j = i;
        while (j < n && ((src[j] >= '0' && src[j] <= '9') || src[j] === '.')) j++;
        toks.push({ t: 'num', v: Number(src.slice(i, j)) }); i = j; continue;
      }
      // identifier
      if (/[A-Za-z_]/.test(c)) {
        let j = i;
        while (j < n && /[A-Za-z0-9_]/.test(src[j])) j++;
        toks.push({ t: 'id', v: src.slice(i, j) }); i = j; continue;
      }
      // punctuation (longest match first)
      let matched = null;
      for (const p of PUNCT) {
        if (src.startsWith(p, i)) { matched = p; break; }
      }
      if (!matched) throw new Error('Unexpected character "' + c + '" in expression');
      toks.push({ t: 'op', v: matched }); i += matched.length;
    }
    toks.push({ t: 'eof', v: null });
    return toks;
  }

  // binary operator precedence (higher binds tighter)
  const PREC = {
    '||': 1, '&&': 2,
    '==': 3, '!=': 3, '<': 4, '>': 4, '<=': 4, '>=': 4,
    '+': 5, '-': 5, '*': 6, '/': 6, '%': 6,
  };

  function parse(src) {
    const toks = tokenize(src);
    let pos = 0;
    const peek = () => toks[pos];
    const next = () => toks[pos++];
    const eat = (v) => {
      const tk = toks[pos];
      if (tk.v !== v) throw new Error('Expected "' + v + '" but got "' + (tk.v == null ? 'end' : tk.v) + '"');
      pos++; return tk;
    };

    function parsePrimary() {
      const tk = peek();
      if (tk.t === 'num') { next(); return { k: 'num', v: tk.v }; }
      if (tk.t === 'str') { next(); return { k: 'str', v: tk.v }; }
      if (tk.t === 'op' && tk.v === '(') {
        next(); const e = parseExpr(0); eat(')'); return e;
      }
      if (tk.t === 'op' && (tk.v === '!' || tk.v === '-')) {
        next(); const operand = parseUnary(); return { k: 'unary', op: tk.v, x: operand };
      }
      if (tk.t === 'id') {
        next();
        // function call?
        if (peek().v === '(') {
          next();
          const args = [];
          const named = {};
          if (peek().v !== ')') {
            do {
              // named argument:  name = expr   (name is a bare identifier, '=' not '==')
              if (peek().t === 'id' && toks[pos + 1] && toks[pos + 1].v === '=') {
                const name = next().v; eat('='); named[name] = parseExpr(0);
              } else {
                args.push(parseExpr(0));
              }
            } while (peek().v === ',' && next());
          }
          eat(')');
          return { k: 'call', name: tk.v, args, named };
        }
        // member chain:  a.b.c
        let node = { k: 'var', name: tk.v };
        while (peek().v === '.') {
          next();
          const prop = next();
          if (prop.t !== 'id') throw new Error('Expected property name after "."');
          node = { k: 'member', obj: node, prop: prop.v };
        }
        return node;
      }
      throw new Error('Unexpected "' + (tk.v == null ? 'end of expression' : tk.v) + '"');
    }

    function parseUnary() { return parsePrimary(); }

    function parseExpr(minPrec) {
      let left = parseUnary();
      while (true) {
        const tk = peek();
        if (tk.t !== 'op' || !(tk.v in PREC)) break;
        const prec = PREC[tk.v];
        if (prec < minPrec) break;
        next();
        const right = parseExpr(prec + 1);
        left = { k: 'binary', op: tk.v, l: left, r: right };
      }
      return left;
    }

    const ast = parseExpr(0);
    if (peek().t !== 'eof') throw new Error('Unexpected trailing input in expression');
    return ast;
  }

  const UNSAFE_PROP = { __proto__: true, constructor: true, prototype: true };

  function evalNode(node, ctx) {
    switch (node.k) {
      case 'num': return node.v;
      case 'str': return node.v;
      case 'var': {
        const name = node.name;
        if (name === 'true') return true;
        if (name === 'false') return false;
        if (name === 'null') return null;
        if (ctx.vars && Object.prototype.hasOwnProperty.call(ctx.vars, name)) return ctx.vars[name];
        throw new Error('Unknown name "' + name + '"');
      }
      case 'member': {
        const obj = evalNode(node.obj, ctx);
        if (obj == null) return undefined;
        if (UNSAFE_PROP[node.prop]) throw new Error('Forbidden property "' + node.prop + '"');
        return obj[node.prop];
      }
      case 'unary': {
        const x = evalNode(node.x, ctx);
        return node.op === '!' ? !truthy(x) : -toNum(x);
      }
      case 'binary': {
        const op = node.op;
        if (op === '&&') return truthy(evalNode(node.l, ctx)) ? evalNode(node.r, ctx) : false;
        if (op === '||') { const l = evalNode(node.l, ctx); return truthy(l) ? l : evalNode(node.r, ctx); }
        const l = evalNode(node.l, ctx), r = evalNode(node.r, ctx);
        switch (op) {
          case '==': return looseEq(l, r);
          case '!=': return !looseEq(l, r);
          case '<': return toNum(l) < toNum(r);
          case '>': return toNum(l) > toNum(r);
          case '<=': return toNum(l) <= toNum(r);
          case '>=': return toNum(l) >= toNum(r);
          case '+': return (typeof l === 'string' || typeof r === 'string') ? ('' + l + r) : (toNum(l) + toNum(r));
          case '-': return toNum(l) - toNum(r);
          case '*': return toNum(l) * toNum(r);
          case '/': return toNum(l) / toNum(r);
          case '%': return toNum(l) % toNum(r);
        }
        throw new Error('Unknown operator ' + op);
      }
      case 'call': {
        const fn = ctx.fns && ctx.fns[node.name];
        if (typeof fn !== 'function') throw new Error('Unknown function "' + node.name + '()"');
        const args = node.args.map((a) => evalNode(a, ctx));
        const named = {};
        for (const key in node.named) named[key] = evalNode(node.named[key], ctx);
        return fn(args, named, ctx);
      }
    }
    throw new Error('Bad node');
  }

  function truthy(v) { return !!v; }
  function toNum(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
  function looseEq(a, b) {
    if (a == null || b == null) return a === b;
    if (typeof a === 'number' || typeof b === 'number') return toNum(a) === toNum(b);
    return String(a) === String(b);
  }

  // Compile a source string into a reusable { eval(ctx) } — validating syntax up
  // front so a malformed expression surfaces at pack load, not mid-game.
  function compileExpr(src, label) {
    if (src == null || src === '') return null;
    let ast;
    try { ast = parse(String(src)); }
    catch (e) { throw new Error('Rule "' + (label || 'expr') + '": ' + e.message); }
    const fn = (ctx) => evalNode(ast, ctx);
    fn.src = String(src);
    return fn;
  }

  /* =========================================================================
   * 2. Grid model — map normalised [0,1] coords <-> discrete cells
   * ========================================================================= */

  function clampInt(v, lo, hi) { return Math.max(lo, Math.min(hi, v | 0)); }

  function makeGrid(cols, rows) {
    return {
      cols, rows,
      cellOf(x, y) {
        return {
          col: clampInt(Math.floor(x * cols), 0, cols - 1),
          row: clampInt(Math.floor(y * rows), 0, rows - 1),
        };
      },
      centerOf(col, row) {
        return { x: (col + 0.5) / cols, y: (row + 0.5) / rows };
      },
    };
  }

  // owner-matrix of the current board: occ[row][col] = { owner, type, id } | null
  function occupancy(grid, markers, ownerOf) {
    const occ = [];
    for (let r = 0; r < grid.rows; r++) occ.push(new Array(grid.cols).fill(null));
    for (const m of markers) {
      const { col, row } = grid.cellOf(m.x, m.y);
      occ[row][col] = { owner: ownerOf(m.type), type: m.type, id: m.id };
    }
    return occ;
  }

  /* =========================================================================
   * 3. Grid query functions exposed to win/draw expressions
   * ========================================================================= */

  const DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];   // →  ↓  ↘  ↗

  function makeGridFns(grid, occ, current) {
    const ownerAt = (c, r) => (occ[r] && occ[r][c]) ? occ[r][c].owner : null;

    // n in a row for a given owner, in any of the four directions
    function line(args, named) {
      const n = toNum(args[0]);
      if (!n) return false;
      const who = ('owner' in named) ? named.owner : current;
      if (who == null) return false;
      for (let r = 0; r < grid.rows; r++) {
        for (let c = 0; c < grid.cols; c++) {
          if (ownerAt(c, r) !== who) continue;
          for (const [dc, dr] of DIRS) {
            let k = 1;
            while (k < n && ownerAt(c + dc * k, r + dr * k) === who) k++;
            if (k >= n) return true;
          }
        }
      }
      return false;
    }

    function full() {
      for (let r = 0; r < grid.rows; r++)
        for (let c = 0; c < grid.cols; c++)
          if (ownerAt(c, r) == null) return false;
      return true;
    }

    function count(args, named) {
      const who = ('owner' in named) ? named.owner : (args.length ? args[0] : current);
      let total = 0;
      for (let r = 0; r < grid.rows; r++)
        for (let c = 0; c < grid.cols; c++) {
          const o = ownerAt(c, r);
          if (who == null ? o != null : o === who) total++;
        }
      return total;
    }

    return { line, full, count };
  }

  /* =========================================================================
   * 4. compile(def) -> ruleset  (or null when the pack opts out)
   * ========================================================================= */

  function ownerMatcher(ownMap) {
    // exact match, then "prefix*" wildcards; falls back to the type itself so a
    // pack whose piece types ARE the player names (x / o) needs no `own` map.
    const exact = {};
    const wild = [];
    for (const k in (ownMap || {})) {
      if (k.endsWith('*')) wild.push({ pre: k.slice(0, -1), to: ownMap[k] });
      else exact[k] = ownMap[k];
    }
    return function ownerOf(type) {
      if (type == null) return null;
      if (Object.prototype.hasOwnProperty.call(exact, type)) return exact[type];
      for (const w of wild) if (type.indexOf(w.pre) === 0) return w.to;
      return type;       // identity default
    };
  }

  function compile(def) {
    const L = def && def.logic;
    if (!L || typeof L !== 'object') return null;
    // rules need a discrete grid; map boards (lng/lat) are out of scope.
    if (def.board && def.board.map) return null;

    // grid: explicit, else derived from the board pattern
    let cols = 0, rows = 0;
    if (L.grid && L.grid.cols && L.grid.rows) { cols = L.grid.cols | 0; rows = L.grid.rows | 0; }
    else if (def.board && def.board.pattern && def.board.pattern.cols && def.board.pattern.rows) {
      cols = def.board.pattern.cols | 0; rows = def.board.pattern.rows | 0;
    }
    if (!cols || !rows) throw new Error('logic needs a grid (logic.grid.cols/rows or a board pattern)');

    const grid = makeGrid(cols, rows);
    const snap = !L.grid || L.grid.snap !== false;            // default on
    const gravity = (L.grid && L.grid.gravity) || null;        // "down" | "up" | null
    const enforce = L.enforce === 'advisory' ? 'advisory' : 'strict';
    const ownerOf = ownerMatcher(L.own);

    const turns = L.turns ? { auto: L.turns.auto !== false } : null;  // auto on by default

    // compiled expressions (validated now)
    const place = L.place || {};
    const move = L.move || null;
    const remove = L.remove || null;
    const placeLegal = compileExpr(place.legal != null ? place.legal : 'cell.empty', 'place.legal');
    const moveLegal = move ? compileExpr(move.legal != null ? move.legal : 'cell.empty', 'move.legal') : null;
    const removeLegal = remove ? compileExpr(remove.legal != null ? remove.legal : 'false', 'remove.legal') : null;
    const wins = (L.win || []).map((w, i) => ({
      when: compileExpr(w.when, 'win[' + i + '].when'),
      result: w.result || '{player} wins!',
    }));
    const draws = (L.draw || []).map((w, i) => ({
      when: compileExpr(w.when, 'draw[' + i + '].when'),
      result: w.result || 'Draw.',
    }));

    // build the per-cell context for a place/move legality check
    function cellContext(occ, col, row) {
      const here = occ[row] && occ[row][col];
      return {
        empty: !here, owner: here ? here.owner : null,
        count: here ? 1 : 0, col, row,
      };
    }

    // apply gravity to a drop column: slide to the furthest empty cell. Returns a
    // new {col,row} or null if the column is full.
    function applyGravity(occ, col) {
      if (gravity === 'down') {
        for (let r = grid.rows - 1; r >= 0; r--) if (!occ[r][col]) return { col, row: r };
        return null;
      }
      if (gravity === 'up') {
        for (let r = 0; r < grid.rows; r++) if (!occ[r][col]) return { col, row: r };
        return null;
      }
      return { col, row: null };       // sentinel: caller keeps the original row
    }

    const ruleset = {
      enforce, snap, gravity, turns,
      grid: { cols, rows },
      ownerOf,
      cellOf: (x, y) => grid.cellOf(x, y),
      centerOf: (c, r) => grid.centerOf(c, r),

      /* validate a proposed action.
       *   action: { kind:'add'|'move'|'remove', type, id?, x, y }
       *   ctx:    { markers:[…], turn:<seat name> }
       * returns { ok, reason, x, y }  (x,y are snapped/gravity-resolved on success)
       */
      validate(action, ctx) {
        const markers = (ctx && ctx.markers) || [];
        const turn = ctx ? ctx.turn : null;

        if (action.kind === 'remove') {
          if (!removeLegal) {
            // default: placed pieces can't be removed under enforcement
            return { ok: false, reason: (remove && remove.reason) || 'Pieces can\'t be removed here.' };
          }
          const occ = occupancy(grid, markers, ownerOf);
          const cur = markers.find((m) => m.id === action.id);
          if (!cur) return { ok: true };
          const { col, row } = grid.cellOf(cur.x, cur.y);
          const vars = baseVars(turn, action.type, cellContext(occ, col, row), null);
          const ok = truthy(safeEval(removeLegal, vars, grid, occ, turn));
          return ok ? { ok: true } : { ok: false, reason: (remove && remove.reason) || 'You can\'t remove that.' };
        }

        // add / move share the target-cell machinery
        const movingId = action.kind === 'move' ? action.id : null;
        // occupancy WITHOUT the piece being moved (so it doesn't block itself)
        const others = movingId ? markers.filter((m) => m.id !== movingId) : markers;
        const occ = occupancy(grid, others, ownerOf);

        let { col, row } = grid.cellOf(action.x, action.y);
        if (gravity) {
          const g = applyGravity(occ, col);
          if (!g) return { ok: false, reason: (place.reason) || 'That column is full.' };
          col = g.col; if (g.row != null) row = g.row;
        }

        const type = action.kind === 'move'
          ? (markers.find((m) => m.id === movingId) || {}).type
          : action.type;

        const fromCell = movingId
          ? (function () { const m = markers.find((x) => x.id === movingId); if (!m) return null; const f = grid.cellOf(m.x, m.y); return cellContext(occ, f.col, f.row); })()
          : null;

        const vars = baseVars(turn, type, cellContext(occ, col, row), fromCell);
        const expr = action.kind === 'move' ? moveLegal : placeLegal;

        if (action.kind === 'move' && !moveLegal) {
          return { ok: false, reason: 'Placed pieces stay put in this game.' };
        }

        let ok;
        try { ok = truthy(safeEval(expr, vars, grid, occ, turn)); }
        catch (e) { return { ok: false, reason: 'Rule error: ' + e.message }; }

        if (!ok) return { ok: false, reason: (action.kind === 'move' ? (move && move.reason) : place.reason) || 'Illegal move.' };

        const out = { ok: true, x: action.x, y: action.y };
        // gravity must reposition to the resolved cell, so it always snaps
        if (snap || gravity) { const c = grid.centerOf(col, row); out.x = c.x; out.y = c.y; }
        return out;
      },

      /* has the game ended?  moverPlayer = the seat that just acted ("current").
       * returns { over, result } — checks win rules first, then draws. */
      outcome(markers, moverPlayer) {
        const occ = occupancy(grid, markers || [], ownerOf);
        const fns = makeGridFns(grid, occ, moverPlayer);
        const ctx = { vars: { turn: moverPlayer, current: moverPlayer }, fns };
        for (const w of wins) {
          if (truthy(w.when(ctx))) return { over: true, result: fill(w.result, moverPlayer), win: true };
        }
        for (const d of draws) {
          if (truthy(d.when(ctx))) return { over: true, result: fill(d.result, moverPlayer), win: false };
        }
        return { over: false };
      },
    };

    // shared variable bag for legality expressions
    function baseVars(turn, type, cell, from) {
      const v = {
        turn,
        piece: { type: type || null, owner: ownerOf(type) },
        cell,
        board: { cols, rows },
      };
      if (from) v.from = from;
      return v;
    }

    return ruleset;
  }

  // run a compiled legality expression with both variables AND the grid funcs
  function safeEval(expr, vars, grid, occ, current) {
    const fns = makeGridFns(grid, occ, current);
    return expr({ vars, fns });
  }

  function fill(tmpl, player) {
    return String(tmpl).replace(/\{player\}/g, player == null ? '' : String(player));
  }

  /* =========================================================================
   * 5. exports (browser global + Node require)
   * ========================================================================= */
  const Rules = { compile, compileExpr, parse, tokenize, makeGrid };
  global.Rules = Rules;
  if (typeof module !== 'undefined' && module.exports) module.exports = Rules;
})(typeof window !== 'undefined' ? window : globalThis);
