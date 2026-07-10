'use strict';

// Opaque bearer session tokens for the admin/super-admin principals.
//
// Why: the client used to keep the actual admin/super-admin password in
// sessionStorage and resend it on every reconnect. That's a plaintext
// credential sitting in browser storage for the lifetime of the tab. Instead,
// a successful password login now issues a random, unguessable token; the
// client stores *that* and resends it to resume the session. The token
// carries no information about the password and is trivially revocable.
//
// In-memory by design, same as RoomManager: a server restart invalidates all
// sessions and admins/players simply sign in again — consistent with the
// rest of the app's ephemeral-state model.

const crypto = require('crypto');

const TOKEN_BYTES = 32;
const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000; // 12h
const SWEEP_INTERVAL_MS = 15 * 60 * 1000;

const tokens = new Map(); // token -> { role: 'admin'|'super', username, expiresAt }

function issue(role, username = null, ttlMs = DEFAULT_TTL_MS) {
  const token = crypto.randomBytes(TOKEN_BYTES).toString('hex');
  tokens.set(token, { role, username, expiresAt: Date.now() + ttlMs });
  return token;
}

// Returns { role, username } if the token is valid and unexpired, else null.
function verify(token) {
  if (!token || typeof token !== 'string') return null;
  const s = tokens.get(token);
  if (!s) return null;
  if (Date.now() > s.expiresAt) {
    tokens.delete(token);
    return null;
  }
  return { role: s.role, username: s.username };
}

function revoke(token) {
  if (typeof token === 'string') tokens.delete(token);
}

// Used when an admin changes their password, so any other signed-in session
// (a second tab, an old device) is forced to log in again with the new one.
function revokeAllForAdmin(username) {
  for (const [t, s] of tokens) {
    if (s.role === 'admin' && s.username === username) tokens.delete(t);
  }
}

const sweep = setInterval(() => {
  const now = Date.now();
  for (const [t, s] of tokens) {
    if (now > s.expiresAt) tokens.delete(t);
  }
}, SWEEP_INTERVAL_MS);
sweep.unref();

module.exports = { issue, verify, revoke, revokeAllForAdmin, _tokens: tokens };
