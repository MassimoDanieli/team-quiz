'use strict';

// Host-password auth. The current secret is either:
//  - a scrypt hash stored in data/auth.json (set via "change password" in the host panel), or
//  - the plaintext HOST_PASSWORD env var (bootstrap / fallback when no auth file exists).
// The file wins over the env var. Player (shared) password is unchanged and env-only.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const AUTH_FILE = process.env.AUTH_FILE || path.join(__dirname, '..', 'data', 'auth.json');
const MIN_LENGTH = 8;

function readFileSecret() {
  try {
    const raw = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
    if (raw && raw.hostHash && raw.hostSalt) return raw;
  } catch (e) {
    /* no file or unreadable -> fall back to env */
  }
  return null;
}

function hash(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString('hex');
}

function timingSafeEq(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// envPassword: config.HOST_PASSWORD ('' => host panel unprotected, as before)
function verify(password, envPassword) {
  const file = readFileSecret();
  if (file) return timingSafeEq(hash(password, file.hostSalt), file.hostHash);
  if (!envPassword) return true; // unprotected mode preserved
  return timingSafeEq(String(password || ''), String(envPassword));
}

// Change the host password: requires the current one. Returns { ok } or { ok:false, error }.
function change(currentPassword, newPassword, envPassword) {
  if (!verify(currentPassword, envPassword)) {
    return { ok: false, error: 'Current password is wrong' };
  }
  const next = String(newPassword || '');
  if (next.length < MIN_LENGTH) {
    return { ok: false, error: 'New password must be at least ' + MIN_LENGTH + ' characters' };
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const record = {
    hostSalt: salt,
    hostHash: hash(next, salt),
    updatedAt: new Date().toISOString()
  };
  const dir = path.dirname(AUTH_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = AUTH_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(record, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, AUTH_FILE);
  return { ok: true };
}

module.exports = { verify, change, MIN_LENGTH, filePath: () => AUTH_FILE };
