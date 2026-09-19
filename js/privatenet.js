/* privatenet.js — the no-network stand-in for Net.
 *
 * A private table is a JustPlay pack running on one device with nobody else
 * attached: no room to join, no invite link, no presence, no cursors. It is
 * what a hidden-movement companion needs — the physical board on the table is
 * already the shared display, so the only thing the screen has to hold is the
 * part nobody else may see.
 *
 * Rather than scatter `if (net)` through app.js, this implements Net's whole
 * surface as no-ops. Everything downstream — state, board, extras, decks —
 * carries on publishing into the void, and the local mirror in state.js keeps
 * the table across a refresh exactly as it does in a room.
 *
 * The room code is still honoured: in private mode it is simply a local save
 * slot, which is how two people on one device keep separate tables.
 */
(function (global) {
  'use strict';

  class PrivateNet {
    constructor(room, identity, handlers) {
      this.room = room;
      this.identity = identity;
      this.handlers = handlers || {};
      this.id = identity && identity.id;
      this.client = null;                 // never connects; kept for shape parity
      this.base = 'private/' + room;
    }

    topic(suffix) { return `${this.base}/${suffix}`; }

    connect() {
      // Announce once so the status dot settles, then stay quiet forever.
      if (this.handlers.onStatus) this.handlers.onStatus('private');
      return this;
    }

    /* ---- every publish is a no-op: there is nobody to tell ---- */
    publishGame()      {}
    publishMarker()    {}
    deleteMarker()     {}
    publishPresence()  {}
    clearPresence()    {}
    publishCursor()    {}
    requestSync()      {}
    sendFull()         {}
    publishDice()      {}
    publishTurn()      {}
    publishDeck()      {}
    publishDeckDraw()  {}

    leave() {}
  }

  global.PrivateNet = PrivateNet;
  if (typeof module !== 'undefined' && module.exports) module.exports = PrivateNet;
})(typeof window !== 'undefined' ? window : globalThis);
