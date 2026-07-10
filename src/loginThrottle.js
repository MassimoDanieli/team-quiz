'use strict';

// Per-IP throttle for authentication attempts (admin/super-admin login).
//
// Independent from the generic per-socket message rate limiter in
// socketHandlers.js: that one caps message *volume* on a single connection.
// This one caps failed *login* attempts from a source IP across any number
// of connections — the thing that actually matters for credential stuffing
// / brute force against admin or super-admin accounts.

const WINDOW_MS = 5 * 60 * 1000; // failed-attempt counting window
const MAX_ATTEMPTS = 8; // failures allowed per window before blocking
const BLOCK_MS = 10 * 60 * 1000; // once blocked, stay blocked this long
const SWEEP_INTERVAL_MS = 15 * 60 * 1000;

const state = new Map(); // ip -> { count, windowStart, blockedUntil }

function isBlocked(ip) {
  const s = state.get(ip);
  return !!(s && s.blockedUntil && Date.now() < s.blockedUntil);
}

function recordFailure(ip) {
  const now = Date.now();
  let s = state.get(ip);
  if (!s || now - s.windowStart > WINDOW_MS) {
    s = { count: 0, windowStart: now, blockedUntil: 0 };
  }
  s.count++;
  if (s.count >= MAX_ATTEMPTS) {
    s.blockedUntil = now + BLOCK_MS;
  }
  state.set(ip, s);
}

// A successful login clears the counter — genuine users who mistype a
// password a couple of times aren't punished once they get it right.
function recordSuccess(ip) {
  state.delete(ip);
}

const sweep = setInterval(() => {
  const now = Date.now();
  for (const [ip, s] of state) {
    const windowStale = now - s.windowStart > WINDOW_MS;
    const notBlocked = !s.blockedUntil || now > s.blockedUntil;
    if (windowStale && notBlocked) state.delete(ip);
  }
}, SWEEP_INTERVAL_MS);
sweep.unref();

module.exports = { isBlocked, recordFailure, recordSuccess, _state: state };
