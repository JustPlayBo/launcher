/* Node self-test for js/track.js — run:  node test/track.test.js
 *
 * The track format is pure data, so nearly all of it is testable without a
 * browser. What matters: the public projection really does drop the secrets,
 * an imported file can't smuggle in a bad shape, and re-walking a route over a
 * graph catches a step that was never connected.
 */
'use strict';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
};

const T = require('../js/track.js');
const { Track, TrackRecorder, parse, validate } = T;

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; return; }
  failed++; console.error('  FAIL  ' + name);
}

/* ---------------- 1. recording ------------------------------------------- */
{
  const t = new Track({ pack: { id: 'sy', name: 'Scotland Yard' }, slot: 'r' });
  t.place({ piece: 'p1', type: 'mrx', node: '13' });
  t.move({ piece: 'p1', type: 'mrx', node: '23', via: 'taxi' });
  t.counter({ id: 'taxi', from: 4, to: 3 });
  t.move({ piece: 'p1', type: 'mrx', node: '46', via: 'bus', reveal: true });
  t.note('surfaced');

  ok('records every entry', t.length === 5);
  ok('counts only moves as moves', t.moveCount === 3);
  const ns = t.entries.filter((e) => e.n != null).map((e) => e.n);
  ok('moves numbered among themselves', ns.join(',') === '1,2,3');
  ok('non-moves carry no move number', t.entries[2].n === undefined);
  ok('every entry is timestamped', t.entries.every((e) => typeof e.t === 'number'));
}

/* ---------------- 2. the public projection ------------------------------- */
{
  const t = new Track({ pack: { id: 'sy' } });
  t.move({ piece: 'p', node: '13', via: 'taxi' });
  t.move({ piece: 'p', node: '46', via: 'bus', reveal: true });
  t.move({ piece: 'p', x: 0.4, y: 0.6, via: 'taxi' });
  t.counter({ id: 'taxi', from: 4, to: 3 });

  const pub = t.publicView();
  ok('hidden move loses its node', pub.entries[0].node === undefined && pub.entries[0].hidden === true);
  ok('hidden move keeps its transport', pub.entries[0].via === 'taxi');
  ok('revealed move keeps its node', pub.entries[1].node === '46' && pub.entries[1].hidden === undefined);
  ok('hidden move loses free-drag coords', pub.entries[2].x === undefined && pub.entries[2].y === undefined);
  ok('non-move events pass through', pub.entries[3].from === 4 && pub.entries[3].to === 3);
  ok('the original is untouched', t.entries[0].node === '13');
  ok('projection is a Track', pub instanceof Track && pub.moveCount === 3);
}

/* ---------------- 3. round trip ------------------------------------------ */
{
  const t = new Track({ pack: { id: 'sy' }, recorder: { name: 'Marco' } });
  t.move({ piece: 'p', node: '13', via: 'taxi' });
  const back = parse(t.toText());
  ok('round-trips through JSON', back.entries.length === 1 && back.entries[0].node === '13');
  ok('keeps its identity', back.id === t.id && back.recorder.name === 'Marco');
  ok('filename looks like a file', /^sy-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}\.track\.json$/.test(t.filename()));
}

/* ---------------- 4. imported files are untrusted ------------------------ */
{
  const bad = (v) => { try { parse(v); return false; } catch (e) { return true; } };
  ok('rejects a non-object', bad('null') && bad('42'));
  ok('rejects a foreign schema', bad(JSON.stringify({ schema: 'track/99', entries: [] })));
  ok('rejects a missing entries array', bad(JSON.stringify({ schema: 'track/1' })));
  ok('rejects malformed JSON', bad('{nope'));

  const t = parse(JSON.stringify({
    schema: 'track/1',
    entries: [{ e: 'move', node: '1' }, null, 'junk', { noKind: true }, { e: 'note', text: 'ok' }],
  }));
  ok('discards malformed entries', t.entries.length === 2);
}

/* ---------------- 5. re-walking a route over a graph --------------------- */
{
  const graph = {
    nodes: { 1: {}, 8: {}, 9: {}, 46: {}, 58: {} },
    edges: [['1', '8', 'taxi'], ['8', '9', 'taxi'], ['9', '46', 'bus'], ['46', '58', 'tube']],
  };

  const good = new Track({});
  good.place({ piece: 'p', node: '1' });
  good.move({ piece: 'p', node: '8', via: 'taxi' });
  good.move({ piece: 'p', node: '9', via: 'taxi' });
  good.move({ piece: 'p', node: '46', via: 'bus' });
  const r1 = validate(good, graph);
  ok('a connected route validates', r1.ok && r1.checked === 3);

  const jump = new Track({});
  jump.place({ piece: 'p', node: '1' });
  jump.move({ piece: 'p', node: '58', via: 'taxi' });
  const r2 = validate(jump, graph);
  ok('an unconnected step is caught', !r2.ok && r2.problems.length === 1);
  ok('the problem names the step', r2.problems[0].from === '1' && r2.problems[0].to === '58' && r2.problems[0].n === 2);

  const wrongVia = new Track({});
  wrongVia.place({ piece: 'p', node: '9' });
  wrongVia.move({ piece: 'p', node: '46', via: 'tube' });   // that link is a bus
  const r3 = validate(wrongVia, graph);
  ok('the wrong transport is caught', !r3.ok && /no tube connection/.test(r3.problems[0].why));

  const freeDrag = new Track({});
  freeDrag.place({ piece: 'p', x: 0.1, y: 0.1 });
  freeDrag.move({ piece: 'p', x: 0.9, y: 0.9 });
  const r4 = validate(freeDrag, graph);
  ok('free-drag steps are skipped, not failed', r4.ok && r4.checked === 0);

  // two pieces interleaved must not be walked as one route
  const two = new Track({});
  two.place({ piece: 'a', node: '1' });
  two.place({ piece: 'b', node: '46' });
  two.move({ piece: 'a', node: '8', via: 'taxi' });
  two.move({ piece: 'b', node: '58', via: 'tube' });
  ok('each piece is walked separately', validate(two, graph).ok);

  ok('validate accepts raw JSON too', validate(good.toText(), graph).ok);
  ok('an empty graph checks nothing', validate(freeDrag, {}).checked === 0);
}

/* ---------------- 6. the recorder ---------------------------------------- */
{
  const off = new TrackRecorder({ slot: 'r1' });
  off.setDef({ id: 'plain', name: 'Plain' });
  ok('disabled unless the pack opts in', !off.enabled && off.track === null);
  ok('recording while disabled is a no-op', off.record('move', { node: '1' }) === null);

  const rec = new TrackRecorder({ slot: 'r1', recorder: { name: 'Marco' } });
  rec.setDef({ id: 'wc', name: 'Whitechapel', track: true }, { night: 1 });
  ok('enabled by the pack flag', rec.enabled && rec.track instanceof Track);
  ok('snapshots the opening counters', rec.track.counters.start.night === 1);

  rec.record('move', { piece: 'p', node: '5' });
  rec.record('move', { piece: 'p', node: '6' });
  ok('records through the recorder', rec.track.moveCount === 2);

  // a refresh mid-game must not lose the route
  const reopened = new TrackRecorder({ slot: 'r1' });
  reopened.setDef({ id: 'wc', name: 'Whitechapel', track: true });
  ok('survives a reload', reopened.track.moveCount === 2);

  // a different pack in the same slot must not inherit someone else's route
  const otherPack = new TrackRecorder({ slot: 'r1' });
  otherPack.setDef({ id: 'sy', name: 'Scotland Yard', track: true });
  ok('a different pack starts fresh', otherPack.track.moveCount === 0);

  const otherRoom = new TrackRecorder({ slot: 'r2' });
  otherRoom.setDef({ id: 'wc', name: 'Whitechapel', track: true });
  ok('a different room starts fresh', otherRoom.track.moveCount === 0);

  reopened.reset({ night: 2 });
  ok('reset clears the route', reopened.track.moveCount === 0);
  ok('reset re-snapshots counters', reopened.track.counters.start.night === 2);
}

/* ---------------- 7. closing ---------------------------------------------- */
{
  const t = new Track({});
  t.move({ piece: 'p', node: '1' });
  ok('open track has no end', t.ended === null);
  t.close({ night: 4 });
  ok('close stamps the end', typeof t.ended === 'number' && t.counters.end.night === 4);
}

console.log(failed
  ? `track.test.js: ${passed} passed, ${failed} FAILED`
  : `track.test.js: ${passed} passed`);
process.exit(failed ? 1 : 0);
