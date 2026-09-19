/* Node self-test for js/rules.js — run:  node test/rules.test.js
 *
 * The rules engine is pure and deterministic, so it can be exercised entirely
 * without a browser. This is the primary correctness gate for enforcement.
 */
'use strict';
const assert = require('assert');
const Rules = require('../js/rules.js');

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, 'FAIL: ' + name);
  passed++;
}
function approx(a, b) { return Math.abs(a - b) < 1e-9; }

/* ---- helpers to build markers like state.js would ---- */
let _id = 0;
const mk = (type, x, y) => ({ id: 'm' + (++_id), type, x, y });
// place a piece at the centre of a (col,row) cell on a cols×rows grid
const at = (type, col, row, cols, rows) => mk(type, (col + 0.5) / cols, (row + 0.5) / rows);

/* ======================================================================== */
/* Tic-tac-toe                                                              */
/* ======================================================================== */
const TTT = {
  board: { pattern: { type: 'grid', cols: 3, rows: 3 } },
  turns: { players: ['X', 'O'] },
  logic: {
    grid: { cols: 3, rows: 3, snap: true },
    turns: { auto: true },
    own: { x: 'X', o: 'O' },
    place: { legal: 'cell.empty && piece.owner == turn' },
    win: [{ when: 'line(3)', result: '{player} wins!' }],
    draw: [{ when: 'full()', result: 'Cat\'s game.' }],
  },
};

(function tictactoe() {
  const rs = Rules.compile(TTT);
  ok('ttt compiles', rs && rs.grid.cols === 3 && rs.grid.rows === 3);

  // X to move places an x in an empty cell — legal, and snapped to the centre
  let v = rs.validate({ kind: 'add', type: 'x', x: 0.1, y: 0.1 }, { markers: [], turn: 'X' });
  ok('ttt legal place', v.ok);
  ok('ttt snaps to cell centre', approx(v.x, 0.5 / 3) && approx(v.y, 0.5 / 3));

  // playing the opponent's piece out of turn is illegal
  v = rs.validate({ kind: 'add', type: 'o', x: 0.5, y: 0.5 }, { markers: [], turn: 'X' });
  ok('ttt wrong piece for turn rejected', !v.ok);

  // can't place on an occupied cell
  const occMarks = [at('x', 1, 1, 3, 3)];
  v = rs.validate({ kind: 'add', type: 'o', x: 0.5, y: 0.5 }, { markers: occMarks, turn: 'O' });
  ok('ttt occupied cell rejected', !v.ok);

  // moving a placed piece is forbidden (no logic.move)
  v = rs.validate({ kind: 'move', id: occMarks[0].id, x: 0.1, y: 0.1 }, { markers: occMarks, turn: 'X' });
  ok('ttt move forbidden', !v.ok);

  // removing a placed piece is forbidden (no logic.remove)
  v = rs.validate({ kind: 'remove', id: occMarks[0].id }, { markers: occMarks, turn: 'X' });
  ok('ttt remove forbidden', !v.ok);

  // top row of X  =>  X wins
  const winRow = [at('x', 0, 0, 3, 3), at('x', 1, 0, 3, 3), at('x', 2, 0, 3, 3)];
  ok('ttt row win', rs.outcome(winRow, 'X').over && rs.outcome(winRow, 'X').result === 'X wins!');

  // a diagonal also wins
  const winDiag = [at('o', 0, 0, 3, 3), at('o', 1, 1, 3, 3), at('o', 2, 2, 3, 3)];
  ok('ttt diagonal win for O', rs.outcome(winDiag, 'O').over && rs.outcome(winDiag, 'O').win);

  // two in a row is not a win
  ok('ttt two-in-row not a win', !rs.outcome([at('x', 0, 0, 3, 3), at('x', 1, 0, 3, 3)], 'X').over);

  // a full board with no line is a draw
  const full = [
    at('x', 0, 0, 3, 3), at('o', 1, 0, 3, 3), at('x', 2, 0, 3, 3),
    at('x', 0, 1, 3, 3), at('o', 1, 1, 3, 3), at('o', 2, 1, 3, 3),
    at('o', 0, 2, 3, 3), at('x', 1, 2, 3, 3), at('x', 2, 2, 3, 3),
  ];
  const fo = rs.outcome(full, 'X');
  ok('ttt full board is a draw', fo.over && fo.win === false && /Cat/.test(fo.result));
})();

/* ======================================================================== */
/* Connect Four (gravity)                                                   */
/* ======================================================================== */
const C4 = {
  board: { pattern: { type: 'grid', cols: 7, rows: 6 } },
  turns: { players: ['R', 'Y'] },
  logic: {
    grid: { cols: 7, rows: 6, snap: true, gravity: 'down' },
    turns: { auto: true },
    own: { r: 'R', y: 'Y' },
    place: { legal: 'piece.owner == turn' },
    win: [{ when: 'line(4)', result: '{player} connects four!' }],
    draw: [{ when: 'full()', result: 'Full board — draw.' }],
  },
};

(function connect4() {
  const rs = Rules.compile(C4);
  // dropping in column 3 of an empty board lands on the BOTTOM row (row 5)
  let v = rs.validate({ kind: 'add', type: 'r', x: 3.5 / 7, y: 0.0 }, { markers: [], turn: 'R' });
  ok('c4 gravity to bottom', v.ok && approx(v.y, 5.5 / 6) && approx(v.x, 3.5 / 7));

  // a second red in the same column stacks on row 4
  const one = [at('r', 3, 5, 7, 6)];
  v = rs.validate({ kind: 'add', type: 'r', x: 3.5 / 7, y: 0.0 }, { markers: one, turn: 'R' });
  ok('c4 gravity stacks', v.ok && approx(v.y, 4.5 / 6));

  // a full column is rejected
  const col = [];
  for (let r = 0; r < 6; r++) col.push(at('r', 2, r, 7, 6));
  v = rs.validate({ kind: 'add', type: 'y', x: 2.5 / 7, y: 0.0 }, { markers: col, turn: 'Y' });
  ok('c4 full column rejected', !v.ok);

  // four reds horizontally on the bottom row wins
  const win = [at('r', 0, 5, 7, 6), at('r', 1, 5, 7, 6), at('r', 2, 5, 7, 6), at('r', 3, 5, 7, 6)];
  ok('c4 horizontal win', rs.outcome(win, 'R').over);
  // three is not enough
  ok('c4 three not a win', !rs.outcome(win.slice(0, 3), 'R').over);
})();

/* ======================================================================== */
/* Gomoku (5 in a row on a big board)                                        */
/* ======================================================================== */
const GOMOKU = {
  board: { pattern: { type: 'grid', cols: 15, rows: 15 } },
  turns: { players: ['Black', 'White'] },
  logic: {
    grid: { cols: 15, rows: 15, snap: true },
    own: { b: 'Black', w: 'White' },
    place: { legal: 'cell.empty && piece.owner == turn' },
    win: [{ when: 'line(5)', result: '{player} wins!' }],
  },
};

(function gomoku() {
  const rs = Rules.compile(GOMOKU);
  const diag = [];
  for (let i = 0; i < 5; i++) diag.push(at('b', 3 + i, 3 + i, 15, 15));
  ok('gomoku diagonal-5 win', rs.outcome(diag, 'Black').over);
  ok('gomoku four-in-row not a win', !rs.outcome(diag.slice(0, 4), 'Black').over);
})();

/* ======================================================================== */
/* DSL sandbox safety + parsing                                              */
/* ======================================================================== */
(function dsl() {
  // prototype pollution / escape attempts must throw
  assert.throws(() => Rules.compileExpr('cell.__proto__')({ vars: { cell: {} }, fns: {} }), /Forbidden/);
  ok('dsl blocks __proto__', true);

  assert.throws(() => Rules.compileExpr('nope()')({ vars: {}, fns: {} }), /Unknown function/);
  ok('dsl blocks unknown functions', true);

  assert.throws(() => Rules.compileExpr('mystery')({ vars: {}, fns: {} }), /Unknown name/);
  ok('dsl blocks unknown identifiers', true);

  // operators & precedence
  const e = Rules.compileExpr('1 + 2 * 3 == 7 && !false');
  ok('dsl arithmetic + precedence + logic', e({ vars: {}, fns: {} }) === true);

  const cmp = Rules.compileExpr("piece.owner == turn");
  ok('dsl member equality true', cmp({ vars: { piece: { owner: 'X' }, turn: 'X' }, fns: {} }) === true);
  ok('dsl member equality false', cmp({ vars: { piece: { owner: 'O' }, turn: 'X' }, fns: {} }) === false);

  // named args parse and reach the function
  let seen = null;
  const named = Rules.compileExpr('line(3, owner=current)');
  named({ vars: { current: 'Z' }, fns: { line: (args, kw) => { seen = { n: args[0], owner: kw.owner }; return true; } } });
  ok('dsl named args', seen && seen.n === 3 && seen.owner === 'Z');

  // malformed expression rejected at compile time
  assert.throws(() => Rules.compileExpr('1 +'), /Rule|Unexpected|Expected/);
  ok('dsl rejects malformed at compile', true);
})();

/* ======================================================================== */
/* Opt-out: a pack with no logic compiles to null (free table)              */
/* ======================================================================== */
(function optOut() {
  ok('no logic -> null', Rules.compile({ board: { pattern: { type: 'checker', cols: 8, rows: 8 } } }) === null);
  ok('map board -> null', Rules.compile({ board: { map: 'x' }, logic: { grid: { cols: 3, rows: 3 } } }) === null);
})();

/* ======================================================================== */
/* The actual shipped packs compile and behave (authoring sanity check).     */
/* Rules.compile reads the same raw shape gamedef.normalize preserves, so we  */
/* can validate the JSON files straight off disk.                            */
/* ======================================================================== */
(function shippedPacks() {
  const fs = require('fs'), path = require('path');
  const load = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'packs', f), 'utf8'));

  const ttt = Rules.compile(load('tictactoe.json'));
  ok('pack tictactoe compiles 3x3', ttt && ttt.grid.cols === 3 && ttt.grid.rows === 3);
  ok('pack tictactoe legal X on turn', ttt.validate({ kind: 'add', type: 'x', x: 0.5, y: 0.5 }, { markers: [], turn: 'X' }).ok);
  ok('pack tictactoe rejects O on X turn', !ttt.validate({ kind: 'add', type: 'o', x: 0.5, y: 0.5 }, { markers: [], turn: 'X' }).ok);
  ok('pack tictactoe row win', ttt.outcome([at('x', 0, 0, 3, 3), at('x', 1, 0, 3, 3), at('x', 2, 0, 3, 3)], 'X').over);

  const c4 = Rules.compile(load('connect4.json'));
  ok('pack connect4 compiles 7x6 gravity', c4 && c4.grid.cols === 7 && c4.gravity === 'down');
  const drop = c4.validate({ kind: 'add', type: 'r', x: 3.5 / 7, y: 0 }, { markers: [], turn: 'Red' });
  ok('pack connect4 drops to bottom', drop.ok && approx(drop.y, 5.5 / 6));

  const gk = Rules.compile(load('gomoku.json'));
  const five = [];
  for (let i = 0; i < 5; i++) five.push(at('b', i, 7, 15, 15));
  ok('pack gomoku five-in-row win', gk && gk.outcome(five, 'Black').over);
})();

console.log('\n  ✓ all ' + passed + ' rules-engine assertions passed\n');
