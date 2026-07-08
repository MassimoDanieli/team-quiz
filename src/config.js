'use strict';

const path = require('path');

const ROOT = path.join(__dirname, '..');

module.exports = {
  ROOT,
  PORT: process.env.PORT || 3000,
  WIN_SCORE: parseInt(process.env.WIN_SCORE || '3', 10),
  SHARED_PASSWORD: process.env.SHARED_PASSWORD || '', // empty => no player password
  HOST_PASSWORD: process.env.HOST_PASSWORD || '', // empty => host panel UNPROTECTED
  MAX_PLAYERS: parseInt(process.env.MAX_PLAYERS || '200', 10),
  TIMER_SECONDS: parseInt(process.env.TIMER_SECONDS || '60', 10), // per-question timer; 0 disables
  NAME_MAX: 24, // max chars for player/team names
  RL_WINDOW_MS: 1000, // rate-limit window per socket
  RL_MAX_EVENTS: 25, // max events per window before dropping
  RL_DISCONNECT_AT: 100, // hard disconnect if wildly over
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  QUESTIONS_DIR: process.env.QUESTIONS_DIR || path.join(ROOT, 'questions'),
  PUBLIC_DIR: path.join(ROOT, 'public')
};
