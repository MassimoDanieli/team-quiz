'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const http = require('node:http');
const { io } = require('socket.io-client');

const ROOT = path.join(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function waitPort(port, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const tick = () => {
      const req = http.get({ host: 'localhost', port, path: '/config' }, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() > deadline) reject(new Error('server did not start'));
        else setTimeout(tick, 100);
      });
    };
    tick();
  });
}

async function startServer(env = {}) {
  const port = 3000 + Math.floor(Math.random() * 5000);
  const dataFile = path.join(os.tmpdir(), `tq-test-${port}-${Date.now()}.json`);
  const proc = spawn('node', ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), DATA_FILE: dataFile, ...env },
    stdio: 'ignore'
  });
  await waitPort(port);
  return {
    port,
    url: `http://localhost:${port}`,
    stop() {
      proc.kill('SIGKILL');
      try {
        fs.unlinkSync(dataFile);
      } catch {
        /* ignore */
      }
    }
  };
}

function connect(url) {
  const sock = io(url, { forceNew: true, transports: ['websocket'] });
  const st = { cur: null, code: null };
  sock.on('state', (s) => {
    st.cur = s;
  });
  sock.on('hostAuthOk', (payload) => {
    if (payload && payload.code) st.code = payload.code;
  });
  return { sock, st };
}

async function waitCode(st, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (st.code) return st.code;
    await sleep(15);
  }
  throw new Error('waitCode: no room code received');
}

async function waitFor(st, pred, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (st.cur && pred(st.cur)) return st.cur;
    await sleep(15);
  }
  throw new Error('waitFor: condition not met in time');
}

// Draw teams, start, and return {host, hostState, a, b, teamOf}
async function setupMatch(url, stackId) {
  const host = connect(url);
  host.sock.emit('host:join', {});
  const code = await waitCode(host.st);
  const a = connect(url);
  const b = connect(url);
  a.sock.emit('player:join', { playerId: 'A-' + Math.random(), name: 'Alice', code });
  b.sock.emit('player:join', { playerId: 'B-' + Math.random(), name: 'Bob', code });
  await waitFor(host.st, (s) => s.players.length >= 2);
  // fresh room each time now, but keep the reset for safety
  host.sock.emit('host:reset');
  await waitFor(host.st, (s) => s.phase === 'login');
  if (stackId) {
    host.sock.emit('host:setStack', { stackId });
    await waitFor(host.st, (s) => s.stackId === stackId);
  }
  host.sock.emit('host:drawTeams');
  await waitFor(host.st, (s) => s.phase === 'ready');
  host.sock.emit('host:start');
  await waitFor(host.st, (s) => s.phase === 'question');
  return { host, a, b, code };
}

describe('game logic', () => {
  let server;
  before(async () => {
    server = await startServer();
  });
  after(() => server.stop());

  test('correct answer scores 1, wrong scores 0', async () => {
    const { host, a, b } = await setupMatch(server.url);
    const correct = host.st.cur.current.correct;
    const wrong = (correct + 1) % 4;
    // Alice is on A or B; figure out both teams by their own state
    const aTeam = a.st.cur.players.find((p) => p.name === 'Alice').team;
    a.sock.emit('team:vote', { answer: correct });
    b.sock.emit('team:vote', { answer: wrong });
    await waitFor(host.st, (s) => s.phase === 'reveal');
    const s = host.st.cur;
    assert.strictEqual(s.teams[aTeam].score, 1, 'correct team should have 1 point');
    const other = aTeam === 'A' ? 'B' : 'A';
    assert.strictEqual(s.teams[other].score, 0, 'wrong team should have 0 points');
    host.sock.close();
    a.sock.close();
    b.sock.close();
  });

  test('a team reaching the win score while ahead ends the game', async () => {
    const { host, a, b } = await setupMatch(server.url);
    const aTeam = a.st.cur.players.find((p) => p.name === 'Alice').team;
    for (let i = 0; i < 6 && host.st.cur.phase !== 'gameover'; i++) {
      const correct = host.st.cur.current.correct;
      a.sock.emit('team:vote', { answer: correct }); // Alice's team always right
      b.sock.emit('team:vote', { answer: (correct + 1) % 4 }); // other team always wrong
      await waitFor(host.st, (s) => s.phase === 'reveal' || s.phase === 'gameover');
      if (host.st.cur.phase === 'reveal') {
        host.sock.emit('host:next');
        await waitFor(host.st, (s) => s.phase === 'question' || s.phase === 'gameover');
      }
    }
    const s = host.st.cur;
    assert.strictEqual(s.phase, 'gameover');
    assert.strictEqual(s.winner, aTeam);
    assert.ok(s.teams[aTeam].score >= 3);
    host.sock.close();
    a.sock.close();
    b.sock.close();
  });

  test('a team vote locks after the first submission', async () => {
    const { host, a, b } = await setupMatch(server.url);
    const aTeam = a.st.cur.players.find((p) => p.name === 'Alice').team;
    const correct = host.st.cur.current.correct;
    a.sock.emit('team:vote', { answer: correct });
    await waitFor(host.st, (s) => s.votes[aTeam] === true);
    a.sock.emit('team:vote', { answer: (correct + 1) % 4 }); // should be ignored
    await sleep(150);
    // other team hasn't voted, so still in question phase and A's vote unchanged
    assert.strictEqual(host.st.cur.phase, 'question');
    host.sock.close();
    a.sock.close();
    b.sock.close();
  });

  test('players never receive the correct answer during a question', async () => {
    const { host, a, b } = await setupMatch(server.url);
    assert.strictEqual(typeof host.st.cur.current.correct, 'number', 'host sees correct');
    assert.strictEqual(typeof a.st.cur.current.correct, 'undefined', 'player must not see correct');
    assert.strictEqual(
      typeof a.st.cur.current.explanation,
      'undefined',
      'player must not see explanation early'
    );
    host.sock.close();
    a.sock.close();
    b.sock.close();
  });

  test('explanation is revealed to players after both vote', async () => {
    const { host, a, b } = await setupMatch(server.url);
    const correct = host.st.cur.current.correct;
    a.sock.emit('team:vote', { answer: correct });
    b.sock.emit('team:vote', { answer: correct });
    await waitFor(a.st, (s) => s.phase === 'reveal');
    assert.strictEqual(typeof a.st.cur.current.explanation, 'string');
    host.sock.close();
    a.sock.close();
    b.sock.close();
  });

  test('questions do not repeat until the set is exhausted', async () => {
    // ai-foundations is a smaller set; play through a full pass and check no early repeat
    const { host, a, b } = await setupMatch(server.url, 'ai-foundations');
    const total = host.st.cur.totalQuestions;
    const seen = new Set();
    seen.add(host.st.cur.current.text);
    let lastNum = host.st.cur.questionNumber;
    let repeatedBeforeExhaustion = false;
    for (let i = 1; i < total; i++) {
      host.sock.emit('host:next');
      await waitFor(host.st, (s) => s.questionNumber === lastNum + 1);
      lastNum++;
      await sleep(45); // stay under the per-socket rate limit (25 events/sec)
      const t = host.st.cur.current.text;
      if (seen.has(t)) {
        repeatedBeforeExhaustion = true;
        break;
      }
      seen.add(t);
    }
    assert.strictEqual(repeatedBeforeExhaustion, false, 'no repeats within one pass of the set');
    assert.strictEqual(seen.size, total);
    host.sock.close();
    a.sock.close();
    b.sock.close();
  });

  test('per-set history is independent', async () => {
    const s = await startServer();
    try {
      // play one question on advanced
      const m = await setupMatch(s.url, 'java-devops-advanced');
      m.host.sock.emit('host:next');
      await waitFor(m.host.st, (x) => x.phase === 'question');
      const stacks = m.host.st.cur.stacks;
      const adv = stacks.find((x) => x.id === 'java-devops-advanced').used;
      const core = stacks.find((x) => x.id === 'java-devops-core').used;
      assert.ok(adv >= 1, 'advanced history advanced');
      assert.strictEqual(core, 0, 'core history untouched');
      m.host.sock.close();
      m.a.sock.close();
      m.b.sock.close();
    } finally {
      s.stop();
    }
  });
  test('an invalid answer is ignored (no lock, no score)', async () => {
    const { host, a, b } = await setupMatch(server.url);
    const aTeam = a.st.cur.players.find((p) => p.name === 'Alice').team;
    a.sock.emit('team:vote', { answer: 9 }); // out of range
    a.sock.emit('team:vote', { answer: 'x' }); // wrong type
    await sleep(150);
    assert.strictEqual(
      host.st.cur.votes[aTeam],
      false,
      'team should not be locked by an invalid vote'
    );
    assert.strictEqual(host.st.cur.phase, 'question');
    host.sock.close();
    a.sock.close();
    b.sock.close();
  });

  test('player names are sanitized and length-capped', async () => {
    const host = connect(server.url);
    host.sock.emit('host:join', {});
    const code = await waitCode(host.st);
    const p = connect(server.url);
    const dirty = 'Bad\u0000Name\n\t' + 'x'.repeat(50);
    p.sock.emit('player:join', { playerId: 'clean-' + Math.random(), name: dirty, code });
    await waitFor(host.st, (s) => s.players.some((pl) => pl.name.startsWith('BadName')));
    const pl = host.st.cur.players.find((x) => x.name.startsWith('BadName'));
    assert.ok(pl.name.length <= 24, 'name capped to 24 chars');
    // eslint-disable-next-line no-control-regex -- intentional: assert control chars are gone
    assert.ok(!/[\u0000-\u001F\u007F]/.test(pl.name), 'control chars stripped');
    host.sock.close();
    p.sock.close();
  });

  test('/healthz reports ok', async () => {
    const body = await new Promise((res) => {
      http.get(server.url + '/healthz', (r) => {
        let d = '';
        r.on('data', (c) => (d += c));
        r.on('end', () => res(JSON.parse(d)));
      });
    });
    assert.strictEqual(body.status, 'ok');
    assert.ok(body.sets >= 1);
  });
});

describe('host authentication', () => {
  let server;
  before(async () => {
    server = await startServer({ HOST_PASSWORD: 'sup3r-secret' });
  });
  after(() => server.stop());

  test('/config advertises that a host password is required', async () => {
    const cfg = await new Promise((res) => {
      http.get(server.url + '/config', (r) => {
        let d = '';
        r.on('data', (c) => (d += c));
        r.on('end', () => res(JSON.parse(d)));
      });
    });
    assert.strictEqual(cfg.requiresHostPassword, true);
  });

  test('wrong host password is rejected and grants no control', async () => {
    const host = connect(server.url);
    let ok = false,
      err = null;
    host.sock.on('hostAuthOk', () => {
      ok = true;
    });
    host.sock.on('hostAuthError', (e) => {
      err = e;
    });
    host.sock.emit('host:join', { password: 'nope' });
    await sleep(300);
    assert.strictEqual(ok, false);
    assert.ok(err, 'should receive hostAuthError');
    // an unauthenticated socket cannot drive the game
    host.sock.emit('host:start');
    await sleep(200);
    assert.notStrictEqual(host.st.cur && host.st.cur.phase, 'question');
    host.sock.close();
  });

  test('correct host password is accepted', async () => {
    const host = connect(server.url);
    let ok = false;
    host.sock.on('hostAuthOk', () => {
      ok = true;
    });
    host.sock.emit('host:join', { password: 'sup3r-secret' });
    await sleep(300);
    assert.strictEqual(ok, true);
    host.sock.close();
  });
});
