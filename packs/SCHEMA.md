# Game pack schema (`boardgame/1`)

A **pack** is a single JSON file that fully describes a shared table: a board and
a set of pieces. The engine has no game-specific code — it loads a pack, renders
it, and syncs piece moves over MQTT. Anyone in a room can load a pack and everyone
switches to it.

A pack can be authored with **zero binary assets**: boards can be generated
patterns and pieces can be unicode/emoji glyphs.

Packs may also carry optional **`rules`**, **`context`**, **`dice`** and **`turns`**
blocks (added in the additive revision **`boardgame/1.1`**) that *tell players how to
play* — a rules drawer, a synced dice roller, and a shared turn indicator. They are
purely informational/assistive: the engine still enforces nothing, and a pack that
omits them behaves exactly as a `boardgame/1` pack. See **Telling players how to play**.

## Top level

| Field         | Type     | Notes                                              |
| ------------- | -------- | -------------------------------------------------- |
| `schema`      | string   | `"boardgame/1"` … `"boardgame/1.4"` (optional, informational) |
| `id`          | string   | stable id, used for room sync identity             |
| `name`        | string   | shown in the lobby, topbar, and menus              |
| `description` | string   | optional blurb (shown atop the rules drawer)       |
| `board`       | object   | see **Board**                                      |
| `pieces`      | array    | see **Pieces** — the tray of draggable tokens      |
| `setup`       | array    | optional preset layout (the "Load sample layout")  |
| `rules`       | object   | optional — how to play (drawer). See below.        |
| `context`     | object   | optional — what/when this game is (drawer). See below. |
| `dice`        | array    | optional — declares a synced dice roller. See below. |
| `turns`       | object   | optional — a shared "whose turn" indicator. See below. |
| `counters`    | array    | optional — player-held +/− supplies, local and never synced. See below. |
| `private`     | bool     | optional — run with no room, no peers and no invite. See below. |

## Board

```json
"board": {
  "image": "url | data-uri",          // a picture board, OR…
  "pattern": { "type": "checker | grid | solid", ... },
  "map": "maplibre-style-url | {…}",   // …OR a live MapLibre map
  "aspect": 1.6,                        // width / height; derived if omitted
  "color": "#140e09",                   // backdrop behind the board
  "pieceSize": 0.05                     // default piece size, fraction of board width
}
```

Give **one** of `image`, `pattern`, or `map`. For an image, `aspect` is auto-detected
from the file if you omit it. Relative `image`/`map` paths resolve against the pack's
own URL.

**Patterns** (generated as crisp inline SVG):

| `type`    | extra fields                                             |
| --------- | -------------------------------------------------------- |
| `solid`   | `color`                                                  |
| `checker` | `cols`, `rows`, `light`, `dark`, `bg`                    |
| `grid`    | `cols`, `rows`, `line`, `bg`, `stars` (array of `[c,r]`) |

For patterns, `aspect` defaults to `cols / rows`.

### Map boards (MapLibre)

Set `board.map` to a [MapLibre GL **style**](https://maplibre.org/maplibre-style-spec/)
— a URL (e.g. `https://tiles.openfreemap.org/styles/liberty`, an OpenFantasyMap style,
or your own) or an inline style object. MapLibre GL is loaded lazily the first time a
map pack is opened.

```json
"board": {
  "map": "https://tiles.openfreemap.org/styles/liberty",
  "center": [8, 30],                          // [lng, lat]
  "zoom": 1.5,
  "grid": { "step": 15, "color": "#3a6ea5", "width": 0.6, "opacity": 0.45 }
}
```

On a map board the **map owns pan & zoom**, and a piece's `x`,`y` is its **`lng`,`lat`**
— tokens pin to real coordinates and stay put as everyone moves the map. `setup`
coordinates are therefore `lng`,`lat` too. The optional `grid` draws a lat/lng
graticule overlay (`step` in degrees).

## Pieces

Each piece is a tray token players can drag onto the board. Use `image` **or**
`glyph`.

```json
{ "type": "wk", "label": "White King", "glyph": "♚", "color": "#f6f2e7" }
{ "type": "jack", "label": "Jack", "image": "../assets/markers/jack.png" }
{ "type": "b", "label": "Black stone", "glyph": "", "bg": "#141414" }
```

| Field   | Notes                                                                 |
| ------- | --------------------------------------------------------------------- |
| `type`  | **required**, unique id; placed markers reference this                 |
| `label` | tray caption / tooltip (defaults to `type`)                           |
| `image` | url or data-uri (relative paths resolve against the pack URL)         |
| `glyph` | unicode/emoji/letters, drawn as text                                 |
| `color` | glyph text colour                                                    |
| `bg`    | if set, the glyph is drawn on a round chip of this colour (e.g. a stone) |
| `size`  | piece size as a fraction of board width (overrides `board.pieceSize`) |

A placed marker whose `type` isn't in the current pack renders as a labelled
fallback chip, so switching packs never breaks the board.

## Setup (optional)

A preset layout loaded on demand from the menu. Coordinates are normalised `[0,1]`.

```json
"setup": [ { "type": "wp", "x": 0.0625, "y": 0.8125 }, … ]
```

## Telling players how to play (optional, `boardgame/1.1`)

The engine is a *bare synced table* — it never enforces rules. These four optional
blocks let a pack carry the human-readable rules and a couple of shared table aids,
so players opening a room they've never seen know what to do. All are optional and
omitting them changes nothing. They ride inside the pack, so they sync to the whole
room automatically (the pack is shared verbatim over MQTT).

### `rules` — the "How to play" drawer

Opens from the **ℹ︎ Rules** button in the topbar (shown only when a pack has `rules`,
`context`, or a `description`).

```json
"rules": {
  "objective": "Bear all your pieces off before your opponent.",
  "players": "2",
  "duration": "10–20 min",
  "setup": "Place the pieces as the sample layout shows…",
  "howToPlay": [ "Roll the dice.", "Move a piece by that many points.", "…" ],
  "winning": "First to bear off every piece wins.",
  "variants": [ "Play to two games out of three." ]
}
```

| Field       | Type            | Notes                                        |
| ----------- | --------------- | -------------------------------------------- |
| `objective` | string          | one-line goal (alias: `goal`)                |
| `players`   | string          | e.g. `"2"`, `"2–4"`                          |
| `duration`  | string          | rough length                                 |
| `setup`     | string          | how the board starts                         |
| `howToPlay` | array\<string\> | ordered steps (aliases: `steps`, `play`)     |
| `winning`   | string          | win/end condition (alias: `win`)             |
| `variants`  | array\<string\> | optional rule variations                     |

### `context` — the "Context" drawer section

```json
"context": {
  "period": "Roman Empire, 1st–4th c. CE",
  "blurb": "A race game found scratched on tavern tables across the empire…",
  "image": "https://upload.wikimedia.org/…/board.jpg",
  "credit": "Roman game board, British Museum (CC BY)",
  "sources": [ "Austin, R. G. (1934). Roman board games. Greece & Rome." ],
  "links": [ { "label": "Tabula — Wikipedia", "url": "https://en.wikipedia.org/wiki/Tabula_(game)" } ]
}
```

| Field     | Type                         | Notes                                  |
| --------- | ---------------------------- | -------------------------------------- |
| `period`  | string                       | shown as a pill                        |
| `blurb`   | string                       | a paragraph (alias: `description`)     |
| `image`   | url                          | hot-linked illustration (relative paths resolve against the pack URL) |
| `credit`  | string                       | caption under the image                |
| `sources` | array\<string\>              | bibliography lines                     |
| `links`   | array\<`{label,url}`\>       | external links (also accepts bare url strings) |

### `dice` — a synced dice roller

Declares one or more dice. Each appears as a button in a floating tray; a roll is
**broadcast to the whole room** (volatile — late joiners don't see past rolls) and
shown as `Name rolled ⚄⚂ = 8`. The engine computes a sum only when all faces are
numeric.

```json
"dice": [
  { "id": "tesserae", "label": "Tesserae", "sides": 6, "count": 2 },
  { "id": "tali", "label": "Tali", "count": 4,
    "faces": [ { "label": "I", "value": 1 }, { "label": "III", "value": 3 },
               { "label": "IV", "value": 4 }, { "label": "VI", "value": 6 } ] }
]
```

| Field   | Type                          | Notes                                            |
| ------- | ----------------------------- | ------------------------------------------------ |
| `id`    | string                        | optional id                                      |
| `label` | string                        | tray caption                                     |
| `sides` | int                           | numeric die `1..sides` (default 6; ignored if `faces`) |
| `count` | int                           | dice rolled together (default 1)                 |
| `faces` | array\<string \| `{label,value}`\> | non-uniform faces (e.g. the four faces of an astragalus). Strings are taken as both label and value. |
| `glyph` | string                        | optional tray glyph (default 🎲)                 |
| `d3d`   | bool                          | set `false` to force the flat roller (default: 3D when available) |
| `themeColor` | string                   | hex tint for the 3D dice                         |

d6 numeric rolls render as pip glyphs (⚀–⚅); everything else shows its label.

**3D physics dice.** When [`@3d-dice/dice-box`](https://github.com/3d-dice/dice-box)
loads, numeric polyhedral dice (`sides` ∈ 4/6/8/10/12/20/100) **tumble in 3D** over the
board and the settled physics values feed the roll — so the animation the roller sees
is exactly the number broadcast to the room. It's progressive enhancement: `faces`
dice (e.g. tali astragali), non-polyhedral sides, browsers without WebGL, or any load
failure fall back to the instant roller automatically. The library is self-hosted in
`lib/dice-box/` (no runtime CDN) and loaded lazily at first roll, so it only downloads
if a 3D roll actually happens.

### `turns` — a shared turn indicator

A chip showing whose go it is, plus a **Next ▸** button anyone can press; the current
seat is **retained**, so late joiners see it. It is an indicator only — nothing is
enforced, and any player may advance it.

```json
"turns": { "players": [ "Albus", "Ruber" ], "track": true }
```

| Field     | Type            | Notes                                                       |
| --------- | --------------- | ----------------------------------------------------------- |
| `players` | array\<string\> | seat names, cycled in order. Omit for a plain "Turn N" counter. |
| `track`   | bool            | defaults `true` when a `turns` block is present             |

If a player's display name matches the active seat name, the chip highlights as
"(you)".

### `decks` — card decks (`boardgame/1.2`)

Declares one or more **card decks** drawn from a [cardsapi.com](https://forge.cardsapi.com)
/ [deckofcardsapi.com](https://deckofcardsapi.com)-compatible API. Each deck shows
a face-down **pile** in the play-aids panel: tap it to deal a card onto the table,
or press **⟳** to shuffle a fresh deck.

```json
"decks": [
  { "id": "main", "label": "Tavern deck",
    "cardforge": "openfantasymap/cardforge-ab12cd",
    "shuffle": true, "back": "🂠", "cardSize": 0.12 }
]
```

| Field       | Type   | Notes                                                            |
| ----------- | ------ | --------------------------------------------------------------- |
| `id`        | string | stable id (used for the shared-deck MQTT topic)                 |
| `label`     | string | pile caption                                                    |
| `cardforge` | string | a CardForge project `"org/repo"` — omit for a **standard 52** deck |
| `api`       | string | API base, default `https://forge.cardsapi.com`                  |
| `shuffle`   | bool   | shuffle on deal (default `true`)                                |
| `back`      | string | pile-face glyph (default `🂠`) or an image URL                   |
| `cardSize`  | number | drawn-card size, fraction of board width (default ~0.12)        |

**How sync works.** The deck API is server-stateful — creating a deck returns a
`deck_id` that owns the shuffle/draw order. The first player to deal **creates** the
deck and publishes its `deck_id` on a **retained** MQTT topic (`deck/<id>`); everyone
else adopts it, so the whole room draws from the **same** deck in the same order, and
late joiners pick it up automatically. A drawn card becomes an ordinary
**image-backed piece** (its rendered PNG/SVG), carried on the marker itself — so it
syncs, persists in `localStorage`, drags, and replays for late joiners like any token.
The engine enforces nothing: anyone may draw, and a dealt card is just a piece.

> Drawing calls `forge.cardsapi.com` from the browser, so a deck needs network access
> (the rest of the engine does not). Without a `cardforge` selector you get the
> standard 52-card deck; with one you get your CardForge project's rendered cards.

### `counters` — player-held supplies (`boardgame/1.4`)

Small **+/− trackers** for the things a player *holds* rather than places: Mr X's
tickets, Jack's carriage moves, a blood pool, the night number.

```json
"counters": [
  { "id": "night",    "label": "Night",    "glyph": "🌙", "start": 1, "min": 1, "max": 4 },
  { "id": "carriage", "label": "Carriage", "glyph": "🐎", "start": 2, "min": 0 }
]
```

| Field   | Type   | Notes                                                        |
| ------- | ------ | ------------------------------------------------------------ |
| `id`    | string | stable key; defaults to `label`, then `counter<i>`            |
| `label` | string | chip caption                                                  |
| `glyph` | string | optional unicode/emoji shown before the label                 |
| `start` | number | starting value (clamped into `min`/`max`); defaults `0`       |
| `min`   | number | floor, defaults `0`. Pass `null` to allow negatives           |
| `max`   | number | ceiling, defaults unbounded                                   |
| `step`  | number | how much each +/− moves, defaults `1`                         |
| `color` | string | optional chip border tint                                     |

**Counters are never synced.** Dice and turns are shared because the table shares
them; a counter is *your* supply. In a companion for a hidden-movement game it is
exactly the state the other players must not see, so values stay on the device, in
`localStorage`, keyed by room + pack id. The room code therefore doubles as a local
save slot, and the **↺** button restores every counter to its `start`.

## Private tables — `private` (`boardgame/1.4`)

```json
"private": true
```

A private table runs the pack on **one device with nobody attached**: no room to
join, no invite link, no presence, no cursors, no broker connection at all. It can
also be requested for any pack with **`?private=1`** in the URL.

This exists for companion play, where the shared display is the *physical board on
the table* and the only thing the screen needs to hold is the part nobody else may
see — a hidden mover's position and their remaining supplies. Pieces, board, rules
drawer, dice and counters all behave exactly as they do in a room; they simply have
no audience.

The room code is still honoured and still scopes the saved board and counters, so
two people sharing one device keep separate tables by using different codes.

## Enforced rules — `logic` (`boardgame/1.3`)

Everything above leaves the table **free**: the engine never refuses a move. A
`logic` block flips that on — the engine (`js/rules.js`) snaps pieces to a grid,
**refuses illegal moves**, advances turns, and **calls the win**. It's the
machine-readable counterpart to the human-readable `rules` drawer: `rules` *tells*
players how to play; `logic` *makes* the board play that way. Packs without `logic`
are completely unaffected.

> Rules apply to **grid boards only** (a `pattern`, or an explicit `logic.grid`).
> Map (`lng/lat`) boards have no cells, so `logic` is ignored on them.

```json
"logic": {
  "enforce": "strict",
  "grid":  { "cols": 3, "rows": 3, "snap": true },
  "turns": { "auto": true },
  "own":   { "x": "X", "o": "O" },
  "place": { "legal": "cell.empty && piece.owner == turn", "reason": "Play on your turn." },
  "win":   [ { "when": "line(3)", "result": "{player} wins!" } ],
  "draw":  [ { "when": "full()", "result": "Cat's game." } ]
}
```

| Field     | Type   | Notes                                                              |
| --------- | ------ | ----------------------------------------------------------------- |
| `enforce` | string | `"strict"` (default) refuses illegal moves; `"advisory"` only warns |
| `grid`    | object | `{ cols, rows, snap, gravity }`. Omit `cols`/`rows` to inherit the board `pattern`'s. `snap` (default `true`) drops pieces to the cell centre. `gravity` `"down"`/`"up"` makes a piece fall to the furthest empty cell in its column (Connect-Four). |
| `turns`   | object | `{ auto: true }` — auto-advance the shared turn after each legal move. Seats come from the existing top-level `turns.players`. |
| `own`     | object | maps a piece `type` → the player who owns it. Supports `"prefix*"` wildcards (e.g. `"w*": "White"`). If omitted, a piece is owned by a player whose name equals its `type`. |
| `place`   | rule   | legality for **adding** a piece from the tray (default: `cell.empty`) |
| `move`    | rule   | legality for **moving** a placed piece. **Omit to forbid moving** once placed. |
| `remove`  | rule   | legality for **removing** a piece. **Omit to forbid removal** (clearing the whole board via the menu still works). |
| `win`     | array  | `[{ when, result }]` — first matching `when` ends the game as a win |
| `draw`    | array  | `[{ when, result }]` — checked after `win`; ends the game as a draw |

A **rule** (`place`/`move`/`remove`) is either a bare expression string or
`{ "legal": "<expr>", "reason": "<why a refusal happened>" }`. `result` strings may
contain `{player}`, replaced with the player who just moved.

### The expression language

`legal`/`when` are written in a tiny **sandboxed** expression language — *not*
JavaScript. There is no `eval`, no access to any browser/JS global, and property
reads are blocked from `__proto__`/`constructor`. An expression can only read the
variables and call the functions the engine provides, so a pack pulled from a URL or
the shared broker can never run code. The worst a hostile expression can do is be
wrong.

**Operators:** `== != < > <= >=`, `&& || !`, `+ - * / %`, parentheses, and
string/number literals.

**Variables** available in `place`/`move`/`remove` `legal`:

| Name          | Meaning                                                      |
| ------------- | ----------------------------------------------------------- |
| `turn`        | the current seat's name (from `turns.players`)              |
| `piece.type`  | the moving piece's `type`                                   |
| `piece.owner` | its owner (via `own`)                                       |
| `cell.empty`  | is the **target** cell empty?                              |
| `cell.owner`  | owner of the piece in the target cell (or `null`)          |
| `cell.col` / `cell.row` | target cell coordinates                          |
| `from.*`      | the **origin** cell (same fields), for `move` only          |
| `board.cols` / `board.rows` | grid dimensions                              |

**Functions** available in `win`/`draw` `when` (they see the whole board; `current`
is the player who just moved):

| Call                       | Returns                                                  |
| -------------------------- | ------------------------------------------------------- |
| `line(n)`                  | is there a run of `n` cells owned by `current`, in any of the four directions (horizontal, vertical, both diagonals)? |
| `line(n, owner=X)`         | same, for a specific owner                              |
| `full()`                   | every cell occupied?                                    |
| `count()` / `count(owner=X)` | number of occupied cells (optionally for one owner)  |

### How enforcement behaves

- **Illegal move** → refused (a ⛔ toast shows `reason`), the piece snaps back, and
  nothing is broadcast. In `advisory` mode the move is allowed with a ⚠ warning.
- **Legal move** → the piece snaps to its cell (and falls, under `gravity`), syncs
  to the room, and — if `turns.auto` — the shared turn advances.
- **Win / draw** → a banner appears and the board locks; **Menu ▸ Clear the board**
  resets it for another game. Every peer runs the same deterministic engine over the
  same board, so everyone sees the same verdict.

> Seats aren't bound to devices — like a real table, anyone *can* reach over and
> place a piece. `piece.owner == turn` enforces that the **right kind** of piece is
> played each turn (so X and O genuinely alternate); it doesn't police *who* is
> sitting in seat X. That's the casual-table trade-off.

Built-in enforced packs to copy from: [`tictactoe.json`](tictactoe.json) (turns +
win/draw), [`connect4.json`](connect4.json) (gravity), and
[`gomoku.json`](gomoku.json) (`line(5)` on a 15×15 board).

## Loading a pack

- Pick a **built-in** in the lobby (registered in `packs/index.json`).
- **URL** — host a pack anywhere CORS-readable and paste its URL.
- **GitHub via jsDelivr** — `gh:<org>/<repo>[@ver]/<path>` or just `<org>/<repo>/<path>`
  resolves to `https://cdn.jsdelivr.net/gh/…`. (`npm:<pkg>/<path>` works too.)
- **Paste JSON** — inline a whole pack; it's shared to the room verbatim over MQTT.
- **Link** — `?game=<id|url|org/repo/path>` on the invite URL preloads a pack.
- **Clean path** — `/<org>/<repo>/<game>` after the app loads that pack from GitHub
  via jsDelivr, e.g. `…/whitechapel/JustPlayBo/whitechapel/packs/chess.json`.
  (Served on GitHub Pages through the SPA `404.html` redirect.)

A pack referenced by any of these forms is shared to the room by its short ref, so it
stays compact; pasted-JSON packs are shared in full.

The room's current pack lives in the retained MQTT topic `lfw/<room>/game` as
`{ "ref": "<ref>" }` or `{ "def": { …whole pack… } }`, so late joiners get it
automatically.
