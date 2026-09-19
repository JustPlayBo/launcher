# Track format (`track/1`)

A **track** is the recorded route of a hidden mover — Jack's path through
Whitechapel, Mr X's stations, Dracula's trail — captured as it is played and
exportable afterwards as a single JSON file.

This is the thing paper loses. The route goes on a pad, the pad goes in the box,
and the best part of the game — *"how did you get from 47 to 12 without passing a
constable?"* — is gone with it.

Enable it per pack with `"track": true`. Values are held on the device and
mirrored to `localStorage` under `lfw:track:<room>:<pack>`, so a refresh
mid-game does not lose the route.

## Two faces

A track is recorded once but read two ways, and the format keeps both:

- **Full** — every position. This is the reveal at the end of the game.
- **Public** — what opponents were legitimately entitled to see *while it was
  being played*. In Scotland Yard the transport is announced every turn but the
  station only on 3, 8, 13, 18 and 24.

So positions are **secret by default**, `via` is public, and `reveal: true`
marks the moves where the mover surfaced. `publicView()` drops every unrevealed
position and stamps the entry `hidden: true`. The **⤓ Public** button exports
that projection; **⤓ Full** exports everything.

## Shape

```json
{
  "schema": "track/1",
  "id": "trk_m1f2x9k3",
  "pack": { "id": "whitechapel", "name": "Whitechapel — Stay At Home", "ref": "packs/whitechapel.json" },
  "slot": "baker-street-42",
  "recorder": { "name": "Marco", "seat": "Jack" },
  "started": 1790000000000,
  "ended": null,
  "counters": { "start": { "night": 1, "carriage": 2 }, "end": null },
  "entries": [
    { "e": "place",   "n": 1, "piece": "m_a1", "type": "jack", "x": 0.31, "y": 0.52, "t": 1790000000100 },
    { "e": "move",    "n": 2, "piece": "m_a1", "type": "jack", "node": "47", "via": "alley", "t": 1790000060000 },
    { "e": "move",    "n": 3, "piece": "m_a1", "type": "jack", "node": "12", "reveal": true, "t": 1790000120000 },
    { "e": "counter", "id": "carriage", "label": "Carriage", "from": 2, "to": 1, "t": 1790000120500 },
    { "e": "note",    "text": "second victim", "t": 1790000180000 }
  ]
}
```

| Entry  | Fields                                              | Notes |
| ------ | --------------------------------------------------- | ----- |
| `place` | `piece`, `type`, `node?`, `x?`, `y?`, `reveal?`   | first appearance of a piece |
| `move`  | `piece`, `type`, `node?`, `via?`, `x?`, `y?`, `reveal?` | a step |
| `remove`| `piece`                                            | taken off the board |
| `counter`| `id`, `label`, `from`, `to`                       | a supply spent or restored |
| `note`  | `text`                                             | free annotation |

Every entry carries `t` (epoch ms). `move` and `place` also carry `n`, their
index **among moves only** — so "move 7" means the seventh step, not the seventh
event.

`piece` is the marker id, which is what makes a track re-walkable: it is the
identity that ties consecutive positions to the same mover.

### Positions: `node` or `x`/`y`

Node-based boards record `node` (and optionally `via`, the connection used).
Free-drag boards record board-fraction `x`/`y`. A track may contain both — a
pack can gain a graph later without invalidating routes recorded before it.

## Validating a route

Given a pack's `board.graph`, `TrackFmt.validate(track, graph)` re-walks the
route and reports any step that was not actually connected:

```js
const { ok, checked, problems } = TrackFmt.validate(track, def.board.graph);
// problems: [{ n, piece, from, to, via, why }]
```

Only node-based steps can be checked; a free-drag board has no notion of a
connection, so those steps are skipped rather than reported as illegal (`checked`
tells you how many were actually verified).

This is what makes an export more than a souvenir: a track exported at the end
of the game can be walked against the map to confirm every step was legal.

> It confirms the *record* is consistent, not that the record is honest — a
> local app can be restarted like a pad can be rewritten. It catches mistakes,
> which are the real problem; it is not a cheat-proof commitment scheme.

## API

```js
TrackFmt.Track            // the record: .move() .place() .remove() .counter() .note()
                          //             .publicView() .toJSON() .toText() .filename()
TrackFmt.TrackRecorder    // live recording for one table, mirrored to localStorage
TrackFmt.parse(input)     // object or JSON string -> Track; throws on a bad shape
TrackFmt.validate(t, g)   // re-walk over a board.graph
TrackFmt.indexGraph(g)    // adjacency index, shared with graph-mode rules
TrackFmt.download(t, o)   // offer as a file; { publicOnly, filename }
```

Imported files are untrusted, so `parse()` checks the schema and discards
malformed entries before anything reads them.
