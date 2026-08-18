'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createGeneratedStore, isUsable } = require('../src/generatedStore');

const silent = { info() {}, warn() {}, error() {}, debug() {} };

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'quiz-generated-'));
}

function engineQuestion(n) {
  return {
    id: `ai-k8s-${n}`,
    topic: 'Kubernetes',
    difficulty: 'hard',
    text: `Persisted question ${n}: why does a pod stay Pending?`,
    options: ['A taint blocks it', 'The image is missing', 'The probe failed', 'The token expired'],
    correct: 0,
    explanation: 'Taints repel pods that do not tolerate them.',
    generated: true
  };
}

test('an unknown stack loads as an empty list rather than failing', () => {
  const store = createGeneratedStore({ dir: tmpDir(), log: silent });
  assert.deepEqual(store.load('ai-nothing-here'), []);
});

test('questions survive a save and load round trip', () => {
  const dir = tmpDir();
  const store = createGeneratedStore({ dir, log: silent });

  store.save('ai-k8s', [engineQuestion(1), engineQuestion(2)]);
  const loaded = createGeneratedStore({ dir, log: silent }).load('ai-k8s');

  assert.equal(loaded.length, 2);
  assert.deepEqual(loaded[0], engineQuestion(1));
});

test('append writes through and refuses duplicates by id', () => {
  const dir = tmpDir();
  const store = createGeneratedStore({ dir, log: silent });
  const known = [];

  assert.equal(store.append('ai-k8s', engineQuestion(1), known), true);
  assert.equal(store.append('ai-k8s', engineQuestion(1), known), false, 'same id twice');
  assert.equal(store.append('ai-k8s', engineQuestion(2), known), true);

  assert.equal(known.length, 2);
  assert.equal(store.load('ai-k8s').length, 2);
});

test('a malformed question is refused rather than persisted', () => {
  const store = createGeneratedStore({ dir: tmpDir(), log: silent });
  const known = [];

  assert.equal(store.append('ai-k8s', { ...engineQuestion(1), options: ['a', 'b'] }, known), false);
  assert.equal(store.append('ai-k8s', { ...engineQuestion(1), correct: 9 }, known), false);
  assert.equal(store.append('ai-k8s', { ...engineQuestion(1), text: '' }, known), false);
  assert.equal(store.append('ai-k8s', null, known), false);
  assert.equal(known.length, 0);
});

test('a corrupt stack file degrades to empty instead of throwing', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'ai-k8s.json'), '{ this is not json');
  const store = createGeneratedStore({ dir, log: silent });
  assert.deepEqual(store.load('ai-k8s'), []);
});

test('unusable entries in an otherwise valid file are dropped on load', () => {
  const dir = tmpDir();
  fs.writeFileSync(
    path.join(dir, 'ai-k8s.json'),
    JSON.stringify({ questions: [engineQuestion(1), { id: 'x', text: 'broken' }] })
  );
  const loaded = createGeneratedStore({ dir, log: silent }).load('ai-k8s');
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].id, 'ai-k8s-1');
});

test('a stack id that could escape the directory is rejected', () => {
  const store = createGeneratedStore({ dir: tmpDir(), log: silent });
  assert.throws(() => store.save('../../etc/passwd', []), /unsafe stack id/);
});

test('the write is atomic: no temp file is left behind', () => {
  const dir = tmpDir();
  createGeneratedStore({ dir, log: silent }).save('ai-k8s', [engineQuestion(1)]);
  const files = fs.readdirSync(dir);
  assert.deepEqual(files, ['ai-k8s.json']);
});

test('isUsable accepts exactly what the engine assumes when serving', () => {
  assert.equal(isUsable(engineQuestion(1)), true);
  assert.equal(isUsable({ ...engineQuestion(1), correct: '0' }), false);
  assert.equal(isUsable({ ...engineQuestion(1), options: ['a', 'b', 'c', ''] }), false);
});
