/* Integration test for the REAL runtime path:  gamedef.normalize() → Rules.compile()
 * run:  node test/integration.test.js
 *
 * The app never hands raw JSON to the engine — it hands the *normalised* def. This
 * test stubs `window` so the browser modules load under Node, then drives the same
 * pipeline app.js uses, proving normLogic() and the engine agree on the shape.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

// the browser modules attach to `window`; give them one (these glyph-only packs
// never touch location/fetch during normalize()).
globalThis.window = globalThis;
require('../js/gamedef.js');           // -> window.GameDef
const Rules = require('../js/rules.js');
const GameDef = globalThis.window.GameDef;

let passed = 0;
const ok = (name, cond) => { assert.ok(cond, 'FAIL: ' + name); passed++; };
const approx = (a, b) => Math.abs(a - b) < 1e-9;
const load = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'packs', f), 'utf8'));

/* ---- tic-tac-toe through the real pipeline ---- */
(function () {
  const def = GameDef.normalize(load('tictactoe.json'), 'http://localhost/');
  ok('normalize keeps logic block', def.logic && def.logic.win.length === 1);
  ok('normalize keeps turns players', def.turns && def.turns.players.join() === 'X,O');

  const rs = Rules.compile(def);       // exactly what applyGame() does
  ok('compile from normalised def', rs && rs.grid.cols === 3);

  // legal X placement on X's turn, snapped to centre
  const v = rs.validate({ kind: 'add', type: 'x', x: 0.2, y: 0.2 }, { markers: [], turn: 'X' });
  ok('normalised: legal + snapped', v.ok && approx(v.x, 0.5 / 3));

  // out-of-turn refused
  ok('normalised: out-of-turn refused',
    !rs.validate({ kind: 'add', type: 'o', x: 0.5, y: 0.5 }, { markers: [], turn: 'X' }).ok);

  // win detected on the normalised ruleset
  const mk = (type, c, r) => ({ id: type + c + r, type, x: (c + 0.5) / 3, y: (r + 0.5) / 3 });
  ok('normalised: win', rs.outcome([mk('o', 0, 0), mk('o', 1, 1), mk('o', 2, 2)], 'O').over);
})();

/* ---- connect four: gravity survives normalisation ---- */
(function () {
  const def = GameDef.normalize(load('connect4.json'), 'http://localhost/');
  const rs = Rules.compile(def);
  ok('normalised connect4 gravity', rs.gravity === 'down');
  const drop = rs.validate({ kind: 'add', type: 'r', x: 0.5, y: 0 }, { markers: [], turn: 'Red' });
  ok('normalised connect4 drops bottom', drop.ok && approx(drop.y, 5.5 / 6));
})();

/* ---- a plain pack (no logic) still normalises and compiles to null ---- */
(function () {
  const def = GameDef.normalize(load('chess.json'), 'http://localhost/');
  ok('chess normalises with no logic', def.logic == null);
  ok('chess compiles to null (free table)', Rules.compile(def) === null);
})();

console.log('\n  ✓ all ' + passed + ' integration assertions passed\n');
