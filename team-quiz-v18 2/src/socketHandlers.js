'use strict';

const config = require('./config');
const logger = require('./logger');
const auth = require('./auth');

// Wire Socket.IO events to per-room game engines via the RoomManager.
// Each socket belongs to at most one room; every event resolves the socket's
// room first, then acts on that room's engine. Broadcasts are scoped to the
// room's Socket.IO rooms: `${code}:hosts` and `${code}:players`.
function registerSocketHandlers(io, manager) {
  function broadcastRoom(code) {
    const room = manager.get(code);
    if (!room) return;
    manager.touch(code);
    io.to(`${code}:hosts`).emit('state', room.engine.publicState('host'));
    io.to(`${code}:players`).emit('state', room.engine.publicState('player'));
  }

  io.on('connection', (socket) => {
    socket.data.role = null;
    socket.data.code = null;

    // Per-socket rate limiting: drop bursts, disconnect flooders.
    socket.use((packet, next) => {
      const now = Date.now();
      const rl = socket._rl || (socket._rl = { start: now, count: 0 });
      if (now - rl.start > config.RL_WINDOW_MS) {
        rl.start = now;
        rl.count = 0;
      }
      rl.count++;
      if (rl.count > config.RL_DISCONNECT_AT) {
        logger.warn({ id: socket.id }, 'socket flooding — disconnecting');
        socket.disconnect(true);
        return;
      }
      if (rl.count > config.RL_MAX_EVENTS) return;
      next();
    });

    const engineOf = () => {
      const room = socket.data.code && manager.get(socket.data.code);
      return room ? room.engine : null;
    };
    const asHost = (fn) => {
      if (socket.data.role !== 'host') return;
      const engine = engineOf();
      if (!engine) {
        socket.emit('roomClosed');
        return;
      }
      const changed = fn(engine);
      if (changed !== false) broadcastRoom(socket.data.code);
    };

    socket.on('host:join', ({ password } = {}) => {
      if (!auth.verify(password, config.HOST_PASSWORD)) {
        logger.warn({ id: socket.id }, 'host auth failed');
        socket.emit('hostAuthError', { reason: 'Wrong host password' });
        return;
      }
      const created = manager.create();
      if (!created) {
        socket.emit('hostAuthError', { reason: 'Server is at capacity, try again shortly' });
        return;
      }
      socket.data.role = 'host';
      socket.data.code = created.code;
      socket.join(`${created.code}:hosts`);
      socket.emit('hostAuthOk', { code: created.code });
      socket.emit('state', created.room.engine.publicState('host'));
    });

    socket.on('host:resume', ({ password, code } = {}) => {
      if (!auth.verify(password, config.HOST_PASSWORD)) {
        socket.emit('hostAuthError', { reason: 'Wrong host password' });
        return;
      }
      const room = code && manager.get(String(code));
      if (!room) {
        socket.emit('roomClosed');
        return;
      }
      socket.data.role = 'host';
      socket.data.code = String(code);
      socket.join(`${code}:hosts`);
      socket.emit('hostAuthOk', { code: String(code) });
      socket.emit('state', room.engine.publicState('host'));
    });

    socket.on('player:join', ({ playerId, name, password, code } = {}) => {
      if (config.SHARED_PASSWORD && password !== config.SHARED_PASSWORD) {
        socket.emit('joinError', { reason: 'Wrong password' });
        return;
      }
      if (!playerId || typeof playerId !== 'string' || playerId.length > 100) {
        socket.emit('joinError', { reason: 'Missing or invalid player id' });
        return;
      }
      const c = String(code || '').trim();
      const room = manager.get(c);
      if (!room) {
        socket.emit('joinError', { reason: 'No game with that code', badCode: true });
        return;
      }
      const res = room.engine.join(playerId, name);
      if (!res.ok) {
        socket.emit('joinError', { reason: res.error });
        return;
      }
      socket.data.role = 'player';
      socket.data.code = c;
      socket.data.playerId = playerId;
      socket.join(`${c}:players`);
      socket.emit('joined', { playerId, name: res.name, code: c });
      socket.emit('state', room.engine.publicState('player'));
      broadcastRoom(c);
    });

    socket.on('host:drawTeams', () =>
      asHost((e) => {
        const r = e.drawTeams();
        if (!r.ok && r.error) socket.emit('hostError', { reason: r.error });
        return r.ok;
      })
    );
    socket.on('host:start', () =>
      asHost((e) => {
        const r = e.start();
        if (!r.ok && r.error) socket.emit('hostError', { reason: r.error });
        return r.ok;
      })
    );
    socket.on('host:next', () => asHost((e) => e.next().ok));
    socket.on('host:reveal', () => asHost((e) => e.hostReveal()));
    socket.on('host:reset', () => asHost((e) => (e.resetMatch(), true)));
    socket.on('host:resetHistory', () => asHost((e) => (e.resetHistory(), true)));
    socket.on('host:setStack', ({ stackId } = {}) => asHost((e) => e.setStack(stackId)));
    socket.on('host:endMatch', () => asHost((e) => e.endMatch().ok));
    socket.on('host:setTimer', ({ seconds } = {}) => asHost((e) => e.setTimer(seconds)));
    socket.on('host:setDifficulty', ({ tiers } = {}) => asHost((e) => e.setDifficulty(tiers)));
    socket.on('host:rerollNames', () => asHost((e) => e.rerollNames()));
    socket.on('host:setName', ({ team, name } = {}) => asHost((e) => e.setName(team, name)));

    socket.on('host:closeRoom', () => {
      if (socket.data.role !== 'host' || !socket.data.code) return;
      const code = socket.data.code;
      io.to(`${code}:players`).emit('roomClosed');
      manager.remove(code);
    });

    socket.on('host:changePassword', ({ current, next } = {}) => {
      if (socket.data.role !== 'host') return;
      const r = auth.change(current, next, config.HOST_PASSWORD);
      if (r.ok) {
        logger.info({ id: socket.id }, 'host password changed');
        socket.emit('passwordChanged');
      } else {
        socket.emit('hostError', { reason: r.error });
      }
    });

    socket.on('team:vote', ({ answer } = {}) => {
      if (socket.data.role !== 'player') return;
      const engine = engineOf();
      if (engine && engine.vote(socket.data.playerId, answer)) broadcastRoom(socket.data.code);
    });

    socket.on('disconnect', () => {
      const { code, playerId } = socket.data;
      if (!code || !playerId) return;
      const room = manager.get(code);
      if (room && room.engine.setConnected(playerId, false)) broadcastRoom(code);
    });
  });

  const ticker = setInterval(() => {
    for (const { code } of manager.list()) {
      const room = manager.get(code);
      if (room && room.engine.checkTimeout()) broadcastRoom(code);
    }
  }, 500);
  if (ticker.unref) ticker.unref();

  const sweeper = setInterval(() => manager.sweep(), 60 * 1000);
  if (sweeper.unref) sweeper.unref();

  return { broadcastRoom };
}

module.exports = { registerSocketHandlers };
