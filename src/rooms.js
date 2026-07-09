'use strict';

const { GameEngine } = require('./game');
const logger = require('./logger');

// Manages many concurrent games ("rooms"), each its own GameEngine instance.
// Rooms are ephemeral: created when a host opens one, discarded when idle.
// Room codes are 4-digit numeric strings (collision-checked on creation).
class RoomManager {
  constructor(engineOpts, { idleMs = 3 * 60 * 60 * 1000, maxRooms = 200 } = {}) {
    this.engineOpts = engineOpts; // { sets, order, store, winScore, ... } minus per-room state
    this.idleMs = idleMs; // discard a room after this long with no activity
    this.maxRooms = maxRooms;
    this.rooms = new Map(); // code -> { engine, createdAt, lastActivity, hostAdmin }
  }

  _newCode() {
    for (let i = 0; i < 50; i++) {
      const code = String(Math.floor(1000 + Math.random() * 9000));
      if (!this.rooms.has(code)) return code;
    }
    return null; // space exhausted (would need >~9000 live rooms)
  }

  // Create a fresh room and return { code, room } or null if capacity is reached.
  create(hostAdmin = null) {
    if (this.rooms.size >= this.maxRooms) return null;
    const code = this._newCode();
    if (!code) return null;
    const engine = new GameEngine(this.engineOpts);
    const now = Date.now();
    const room = { engine, createdAt: now, lastActivity: now, hostAdmin };
    this.rooms.set(code, room);
    logger.info({ code, hostAdmin }, 'room created');
    return { code, room };
  }

  get(code) {
    return this.rooms.get(code) || null;
  }

  has(code) {
    return this.rooms.has(code);
  }

  touch(code) {
    const room = this.rooms.get(code);
    if (room) room.lastActivity = Date.now();
  }

  remove(code) {
    if (this.rooms.delete(code)) logger.info({ code }, 'room removed');
  }

  list() {
    return [...this.rooms.entries()].map(([code, r]) => ({
      code,
      hostAdmin: r.hostAdmin,
      phase: r.engine.phase,
      players: r.engine.playerCount(),
      createdAt: r.createdAt,
      lastActivity: r.lastActivity
    }));
  }

  count() {
    return this.rooms.size;
  }

  // The room owned by a given admin (one at a time), or null.
  findByAdmin(username) {
    for (const [code, r] of this.rooms) {
      if (r.hostAdmin === username) return { code, room: r };
    }
    return null;
  }

  // Remove an admin's room (used when the super-admin deletes them). Returns the code or null.
  removeByAdmin(username) {
    const found = this.findByAdmin(username);
    if (!found) return null;
    this.rooms.delete(found.code);
    return found.code;
  }

  // Discard rooms idle for longer than idleMs. Returns removed codes.
  sweep(now = Date.now()) {
    const removed = [];
    for (const [code, r] of this.rooms) {
      if (now - r.lastActivity > this.idleMs) {
        this.rooms.delete(code);
        removed.push(code);
      }
    }
    if (removed.length) logger.info({ removed }, 'idle rooms swept');
    return removed;
  }
}

module.exports = { RoomManager };
