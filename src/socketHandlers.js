'use strict';

const config = require('./config');
const logger = require('./logger');
const auth = require('./auth');

// Wire Socket.IO events to the game engine. Returns { broadcast }.
function registerSocketHandlers(io, engine) {
  function broadcast() {
    io.to('hosts').emit('state', engine.publicState('host'));
    io.to('players').emit('state', engine.publicState('player'));
  }

  io.on('connection', (socket) => {
    let role = null;

    // Per-socket rate limiting: drop events above a threshold, disconnect flooders.
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
      if (rl.count > config.RL_MAX_EVENTS) return; // silently drop excess events
      next();
    });

    socket.on('host:join', ({ password } = {}) => {
      if (!auth.verify(password, config.HOST_PASSWORD)) {
        logger.warn({ id: socket.id }, 'host auth failed');
        socket.emit('hostAuthError', { reason: 'Wrong host password' });
        return;
      }
      role = 'host';
      socket.join('hosts');
      socket.emit('hostAuthOk');
      socket.emit('state', engine.publicState('host'));
    });

    socket.on('player:join', ({ playerId, name, password } = {}) => {
      if (config.SHARED_PASSWORD && password !== config.SHARED_PASSWORD) {
        socket.emit('joinError', { reason: 'Wrong password' });
        return;
      }
      if (!playerId || typeof playerId !== 'string' || playerId.length > 100) {
        socket.emit('joinError', { reason: 'Missing or invalid player id' });
        return;
      }
      const res = engine.join(playerId, name);
      if (!res.ok) {
        socket.emit('joinError', { reason: res.error });
        return;
      }
      role = 'player';
      socket.data.playerId = playerId;
      socket.join('players');
      socket.emit('joined', { playerId, name: res.name });
      socket.emit('state', engine.publicState('player'));
      broadcast();
    });

    // ---- Host controls ----
    socket.on('host:drawTeams', () => {
      if (role !== 'host') return;
      const r = engine.drawTeams();
      if (r.ok) broadcast();
      else if (r.error) socket.emit('hostError', { reason: r.error });
    });

    socket.on('host:start', () => {
      if (role !== 'host') return;
      const r = engine.start();
      if (r.ok) broadcast();
      else if (r.error) socket.emit('hostError', { reason: r.error });
    });

    socket.on('host:next', () => {
      if (role !== 'host') return;
      if (engine.next().ok) broadcast();
    });

    socket.on('host:reveal', () => {
      if (role !== 'host') return;
      if (engine.hostReveal()) broadcast();
    });

    socket.on('host:reset', () => {
      if (role !== 'host') return;
      engine.resetMatch();
      broadcast();
    });

    socket.on('host:resetHistory', () => {
      if (role !== 'host') return;
      engine.resetHistory();
      broadcast();
    });

    socket.on('host:setStack', ({ stackId } = {}) => {
      if (role !== 'host') return;
      if (engine.setStack(stackId)) broadcast();
    });

    socket.on('host:endMatch', () => {
      if (role !== 'host') return;
      if (engine.endMatch().ok) broadcast();
    });

    socket.on('host:setTimer', ({ seconds } = {}) => {
      if (role !== 'host') return;
      if (engine.setTimer(seconds)) broadcast();
    });

    socket.on('host:setDifficulty', ({ tiers } = {}) => {
      if (role !== 'host') return;
      if (engine.setDifficulty(tiers)) broadcast();
    });

    socket.on('host:changePassword', ({ current, next } = {}) => {
      if (role !== 'host') return;
      const r = auth.change(current, next, config.HOST_PASSWORD);
      if (r.ok) {
        logger.info({ id: socket.id }, 'host password changed');
        socket.emit('passwordChanged');
      } else {
        socket.emit('hostError', { reason: r.error });
      }
    });

    socket.on('host:rerollNames', () => {
      if (role !== 'host') return;
      if (engine.rerollNames()) broadcast();
    });

    socket.on('host:setName', ({ team, name } = {}) => {
      if (role !== 'host') return;
      if (engine.setName(team, name)) broadcast();
    });

    // ---- Voting (one vote per team) ----
    socket.on('team:vote', ({ answer } = {}) => {
      if (role !== 'player') return;
      if (engine.vote(socket.data.playerId, answer)) broadcast();
    });

    socket.on('disconnect', () => {
      const pid = socket.data.playerId;
      if (pid && engine.setConnected(pid, false)) broadcast();
    });
  });

  // Question timer: reveal automatically when the deadline passes.
  const ticker = setInterval(() => {
    if (engine.checkTimeout()) broadcast();
  }, 500);
  if (ticker.unref) ticker.unref();

  return { broadcast };
}

module.exports = { registerSocketHandlers };
