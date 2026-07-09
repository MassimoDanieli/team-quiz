'use strict';

// Persistent admin accounts + super-admin verification (Tappa B).
//
// - Admins live in data/admins.json (gitignored), passwords stored as scrypt hashes.
//   The super-admin creates them; each admin can host their own room.
// - The super-admin is env-based (SUPER_ADMIN_USER / SUPER_ADMIN_PASSWORD): it holds
//   no game state, only manages admins. If the password is unset, the super panel is
//   LOCKED (all logins fail) rather than open — this is the most powerful role.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ADMINS_FILE = process.env.ADMINS_FILE || path.join(__dirname, '..', 'data', 'admins.json');
const MIN_PASSWORD = 8;
const USERNAME_RE = /^[a-zA-Z0-9_-]{3,32}$/;

function hash(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString('hex');
}

function timingSafeEq(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function readAll() {
  try {
    const raw = JSON.parse(fs.readFileSync(ADMINS_FILE, 'utf8'));
    if (Array.isArray(raw)) return raw;
  } catch (e) {
    /* no file yet, or unreadable — treat as empty */
  }
  return [];
}

function writeAll(list) {
  const dir = path.dirname(ADMINS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = ADMINS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, ADMINS_FILE);
}

// ---- Admin store (public: never returns hashes/salts) ----

function list() {
  return readAll().map((a) => ({
    username: a.username,
    createdAt: a.createdAt,
    createdBy: a.createdBy || null
  }));
}

function exists(username) {
  const u = String(username || '').trim();
  return readAll().some((a) => a.username === u);
}

function create(username, password, createdBy) {
  const u = String(username || '').trim();
  if (!USERNAME_RE.test(u)) {
    return { ok: false, error: 'Username must be 3–32 chars: letters, numbers, _ or -' };
  }
  if (String(password || '').length < MIN_PASSWORD) {
    return { ok: false, error: 'Password must be at least ' + MIN_PASSWORD + ' characters' };
  }
  const all = readAll();
  if (all.some((a) => a.username === u)) {
    return { ok: false, error: 'That username already exists' };
  }
  const salt = crypto.randomBytes(16).toString('hex');
  all.push({
    username: u,
    salt,
    hash: hash(password, salt),
    createdAt: new Date().toISOString(),
    createdBy: createdBy || null
  });
  writeAll(all);
  return { ok: true };
}

function verify(username, password) {
  const a = readAll().find((x) => x.username === String(username || '').trim());
  if (!a) return false;
  return timingSafeEq(hash(password, a.salt), a.hash);
}

function setPassword(username, newPassword) {
  if (String(newPassword || '').length < MIN_PASSWORD) {
    return { ok: false, error: 'Password must be at least ' + MIN_PASSWORD + ' characters' };
  }
  const all = readAll();
  const a = all.find((x) => x.username === String(username || '').trim());
  if (!a) return { ok: false, error: 'No such admin' };
  a.salt = crypto.randomBytes(16).toString('hex');
  a.hash = hash(newPassword, a.salt);
  writeAll(all);
  return { ok: true };
}

function changePassword(username, current, next) {
  if (!verify(username, current)) return { ok: false, error: 'Current password is wrong' };
  return setPassword(username, next);
}

function remove(username) {
  const all = readAll();
  const u = String(username || '').trim();
  const idx = all.findIndex((x) => x.username === u);
  if (idx === -1) return { ok: false, error: 'No such admin' };
  all.splice(idx, 1);
  writeAll(all);
  return { ok: true };
}

// ---- Super-admin (env-based) ----

// Locked (always false) when envPassword is empty — the super panel must be
// explicitly enabled by setting SUPER_ADMIN_PASSWORD.
function verifySuper(username, password, envUser, envPassword) {
  if (!envPassword) return false;
  const uOk = timingSafeEq(username, envUser || 'superadmin');
  const pOk = timingSafeEq(password, envPassword);
  return uOk && pOk;
}

module.exports = {
  list,
  exists,
  create,
  verify,
  setPassword,
  changePassword,
  remove,
  verifySuper,
  MIN_PASSWORD,
  filePath: () => ADMINS_FILE
};
