'use strict';

const express = require('express');
const http = require('http');
const helmet = require('helmet');
const { Server } = require('socket.io');

const config = require('./src/config');
const logger = require('./src/logger');
const store = require('./store');
const { loadSets } = require('./src/questions');
const { RoomManager } = require('./src/rooms');
const admins = require('./src/admins');
const { registerSocketHandlers } = require('./src/socketHandlers');

// ---- Load content + build the room manager ----
const { sets, order } = loadSets(config.QUESTIONS_DIR);
const manager = new RoomManager({
  sets,
  order,
  store,
  winScore: config.WIN_SCORE,
  requiresPassword: !!config.SHARED_PASSWORD,
  maxPlayers: config.MAX_PLAYERS,
  timerSeconds: config.TIMER_SECONDS
});

// ---- HTTP app ----
const app = express();

// Security headers. CSP is intentionally pragmatic: the pages use inline <script>
// blocks and inline style="" attributes, so those are allowed; everything else is
// locked to same-origin. data: is needed for a small inline SVG in CSS.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"]
      }
    },
    crossOriginEmbedderPolicy: false
  })
);

// Legacy page names (pre-1.3.0) — permanent redirects so old links keep working.
app.get('/instructions.html', (req, res) => res.redirect(301, '/guide.html'));
app.get('/overview.html', (req, res) => res.redirect(301, '/tech.html'));

app.use(express.static(config.PUBLIC_DIR));

app.get('/config', (req, res) =>
  res.json({
    requiresPassword: !!config.SHARED_PASSWORD,
    superEnabled: !!config.SUPER_ADMIN_PASSWORD
  })
);

// Lightweight health check for monitoring / load-balancer probes.
app.get('/healthz', (req, res) =>
  res.json({
    status: 'ok',
    uptime: Math.round(process.uptime()),
    sets: order.length,
    rooms: manager.count(),
    admins: admins.list().length,
    players: manager.list().reduce((n, r) => n + r.players, 0)
  })
);

// ---- Realtime ----
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 1e4 // 10 KB — cap frame size so a client can't send huge payloads
});
registerSocketHandlers(io, manager);

// ---- Start ----
server.listen(config.PORT, () => {
  logger.info(
    {
      port: Number(config.PORT),
      winScore: config.WIN_SCORE,
      sets: order.length,
      playerPassword: !!config.SHARED_PASSWORD,
      superEnabled: !!config.SUPER_ADMIN_PASSWORD,
      admins: admins.list().length,
      store: store.filePath()
    },
    `Quiz server listening on :${config.PORT}`
  );
  order.forEach((id) =>
    logger.info(`  set: ${id} (${sets[id].questions.length}) ${sets[id].name}`)
  );
  if (!config.SUPER_ADMIN_PASSWORD) {
    logger.warn(
      'SUPER_ADMIN_PASSWORD is not set — the super-admin panel is LOCKED. Set it to create admin accounts.'
    );
  } else if (admins.list().length === 0) {
    logger.warn(
      'No admin accounts yet — sign in at /admin.html as the super-admin and create one before anyone can host.'
    );
  }
});

// ---- Graceful shutdown ----
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');
  io.close(() => {
    server.close(() => {
      logger.info('closed cleanly');
      process.exit(0);
    });
  });
  setTimeout(() => {
    logger.warn('forced exit');
    process.exit(1);
  }, 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = { app, manager };
