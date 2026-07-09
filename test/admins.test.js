'use strict';

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'quiz-admins-'));
process.env.ADMINS_FILE = path.join(TMP, 'admins.json');

const { test, describe } = require('node:test');
const assert = require('node:assert');
const admins = require('../src/admins');

describe('admins store', () => {
  test('starts empty', () => {
    assert.deepStrictEqual(admins.list(), []);
    assert.strictEqual(admins.exists('pippo'), false);
  });

  test('create validates username and password', () => {
    assert.strictEqual(admins.create('ab', 'longenough1').ok, false, 'username too short');
    assert.strictEqual(admins.create('bad name', 'longenough1').ok, false, 'space in username');
    assert.strictEqual(admins.create('pippo', 'short').ok, false, 'password too short');
    assert.ok(admins.create('pippo', 'password1').ok);
    assert.ok(admins.exists('pippo'));
  });

  test('duplicate usernames are rejected', () => {
    assert.strictEqual(admins.create('pippo', 'another12').ok, false);
  });

  test('list never leaks hashes or salts', () => {
    const row = admins.list().find((a) => a.username === 'pippo');
    assert.ok(row);
    assert.strictEqual(row.hash, undefined);
    assert.strictEqual(row.salt, undefined);
    assert.strictEqual(row.createdBy, null);
  });

  test('verify accepts the right password and rejects wrong ones', () => {
    assert.ok(admins.verify('pippo', 'password1'));
    assert.strictEqual(admins.verify('pippo', 'nope'), false);
    assert.strictEqual(admins.verify('ghost', 'whatever'), false);
  });

  test('no plaintext password on disk', () => {
    const raw = fs.readFileSync(process.env.ADMINS_FILE, 'utf8');
    assert.ok(!raw.includes('password1'), 'password must not be stored in clear');
  });

  test('setPassword (super reset) changes the credential', () => {
    assert.ok(admins.setPassword('pippo', 'brandnew9').ok);
    assert.strictEqual(admins.verify('pippo', 'password1'), false);
    assert.ok(admins.verify('pippo', 'brandnew9'));
  });

  test('changePassword requires the current password', () => {
    assert.strictEqual(admins.changePassword('pippo', 'wrong', 'evenNewer1').ok, false);
    assert.ok(admins.changePassword('pippo', 'brandnew9', 'evenNewer1').ok);
    assert.ok(admins.verify('pippo', 'evenNewer1'));
  });

  test('remove deletes the account', () => {
    admins.create('topolino', 'password1', 'super');
    assert.ok(admins.exists('topolino'));
    assert.ok(admins.remove('topolino').ok);
    assert.strictEqual(admins.exists('topolino'), false);
    assert.strictEqual(admins.remove('topolino').ok, false, 'removing twice fails');
  });

  test('verifySuper is locked when no env password is set', () => {
    assert.strictEqual(admins.verifySuper('superadmin', 'x', 'superadmin', ''), false);
  });

  test('verifySuper checks both username and password', () => {
    assert.ok(admins.verifySuper('boss', 'secret', 'boss', 'secret'));
    assert.strictEqual(admins.verifySuper('boss', 'wrong', 'boss', 'secret'), false);
    assert.strictEqual(admins.verifySuper('nope', 'secret', 'boss', 'secret'), false);
  });
});
