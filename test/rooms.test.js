'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { loadSets } = require('../src/questions');
const { RoomManager } = require('../src/rooms');

const QUESTIONS_DIR = path.join(__dirname, '..', 'questions');

function fakeStore() {
  const m = {};
  return {
    getUsed: (id) => m[id] || [],
    markUsed: (id, q) => (m[id] = m[id] || []).push(q),
    resetUsed: (id) => (m[id] = []),
    filePath: () => ':memory:'
  };
}

function newManager(opts = {}) {
  const { sets, order } = loadSets(QUESTIONS_DIR);
  return new RoomManager(
    { sets, order, store: fakeStore(), winScore: 3, requiresPassword: false, maxPlayers: 200 },
    opts
  );
}

describe('RoomManager', () => {
  test('create returns a 4-digit numeric code and a live engine', () => {
    const m = newManager();
    const { code, room } = m.create();
    assert.match(code, /^\d{4}$/);
    assert.ok(room.engine);
    assert.strictEqual(room.engine.phase, 'login');
    assert.strictEqual(m.count(), 1);
  });

  test('codes are unique across many rooms', () => {
    const m = newManager();
    const seen = new Set();
    for (let i = 0; i < 50; i++) {
      const { code } = m.create();
      assert.ok(!seen.has(code), 'duplicate code ' + code);
      seen.add(code);
    }
    assert.strictEqual(m.count(), 50);
  });

  test('rooms are independent — score in one does not affect another', () => {
    const m = newManager();
    const a = m.create().room.engine;
    const b = m.create().room.engine;
    a.join('p1', 'Ann');
    a.join('p2', 'Bo');
    a.drawTeams();
    a.start();
    const c = a.game.current.correct;
    // whatever teams they landed in, one right and one wrong => exactly 1 point total
    a.vote('p1', c);
    a.vote('p2', a.game.players.p1.team === a.game.players.p2.team ? c : (c + 1) % 4);
    const total = a.game.teams.A.score + a.game.teams.B.score;
    assert.ok(total === 1, 'exactly one team scored, got total ' + total);
    // b is untouched
    assert.strictEqual(b.phase, 'login');
    assert.strictEqual(b.playerCount(), 0);
  });

  test('get/has/remove behave', () => {
    const m = newManager();
    const { code } = m.create();
    assert.ok(m.has(code));
    assert.ok(m.get(code));
    m.remove(code);
    assert.strictEqual(m.has(code), false);
    assert.strictEqual(m.get(code), null);
  });

  test('maxRooms caps creation', () => {
    const m = newManager({ maxRooms: 2 });
    assert.ok(m.create());
    assert.ok(m.create());
    assert.strictEqual(m.create(), null);
  });

  test('sweep removes idle rooms and keeps active ones', () => {
    const m = newManager({ idleMs: 1000 });
    const stale = m.create().code;
    const fresh = m.create().code;
    // age the stale room's lastActivity
    m.get(stale).lastActivity = Date.now() - 5000;
    const removed = m.sweep();
    assert.deepStrictEqual(removed, [stale]);
    assert.ok(m.has(fresh));
    assert.strictEqual(m.has(stale), false);
  });

  test('touch updates lastActivity', () => {
    const m = newManager();
    const { code } = m.create();
    const before = m.get(code).lastActivity;
    m.get(code).lastActivity = before - 10000;
    m.touch(code);
    assert.ok(m.get(code).lastActivity > before - 10000);
  });

  test('list reports code, phase and player count per room', () => {
    const m = newManager();
    const { code } = m.create();
    m.get(code).engine.join('p1', 'Ann');
    const rows = m.list();
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].code, code);
    assert.strictEqual(rows[0].phase, 'login');
    assert.strictEqual(rows[0].players, 1);
  });
});
