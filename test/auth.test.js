'use strict';

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

// Point the auth module at a throwaway file BEFORE requiring it.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'quiz-auth-'));
process.env.AUTH_FILE = path.join(TMP, 'auth.json');

const { test, describe } = require('node:test');
const assert = require('node:assert');
const auth = require('../src/auth');

describe('auth — host password', () => {
  test('env fallback: verifies against HOST_PASSWORD when no auth file exists', () => {
    assert.ok(auth.verify('sesamo123', 'sesamo123'));
    assert.strictEqual(auth.verify('wrong', 'sesamo123'), false);
  });

  test('unprotected mode preserved: empty env password accepts anything', () => {
    assert.ok(auth.verify('', ''));
    assert.ok(auth.verify('whatever', ''));
  });

  test('change: rejects wrong current password and too-short new password', () => {
    assert.strictEqual(auth.change('wrong', 'newpassword1', 'sesamo123').ok, false);
    const r = auth.change('sesamo123', 'short', 'sesamo123');
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /at least 8/);
  });

  test('change: stores a salted hash; file wins over env afterwards', () => {
    assert.ok(auth.change('sesamo123', 'nuovaPassword9', 'sesamo123').ok);
    const raw = JSON.parse(fs.readFileSync(process.env.AUTH_FILE, 'utf8'));
    assert.ok(raw.hostHash && raw.hostSalt);
    assert.ok(!JSON.stringify(raw).includes('nuovaPassword9'), 'no plaintext on disk');
    assert.ok(auth.verify('nuovaPassword9', 'sesamo123'));
    assert.strictEqual(
      auth.verify('sesamo123', 'sesamo123'),
      false,
      'old env password no longer valid'
    );
  });

  test('change again: requires the file password as current', () => {
    assert.strictEqual(auth.change('sesamo123', 'ennesimaPass1', 'sesamo123').ok, false);
    assert.ok(auth.change('nuovaPassword9', 'ennesimaPass1', 'sesamo123').ok);
    assert.ok(auth.verify('ennesimaPass1', ''));
  });
});
