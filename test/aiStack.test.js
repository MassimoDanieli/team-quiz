'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createAiStacks, toEngineQuestion, stackIdFor } = require('../src/aiStack');
const { GameEngine } = require('../src/game');

const silent = { info() {}, warn() {}, error() {}, debug() {} };

function generated(n) {
  return {
    id: `ai-k8s-${n}`,
    question: `Generated question ${n}: why does a pod stay Pending?`,
    options: ['A taint blocks it', 'The image is missing', 'The probe failed', 'The token expired'],
    correctIndex: 0,
    explanation: 'Taints repel pods that do not tolerate them.',
    topic: 'Kubernetes',
    difficulty: 'hard',
    source: 'ai'
  };
}

/** A quiz-ai stand-in whose buffer contents the test controls. */
function fakeAi({ supply = 5 } = {}) {
  const prewarmed = [];
  let served = 0;
  const queue = {
    size: supply,
    health: null,
    take() {
      if (served >= supply) return { question: null, source: 'none' };
      queue.size -= 1;
      return { question: generated(served++), source: 'ai' };
    },
    prime: async () => supply,
    stop() {}
  };
  const api = {
    prewarmed,
    queue,
    lastQueueOptions: null,
    createQueue: (opts) => {
      api.lastQueueOptions = opts;
      return queue;
    },
    prewarm: async (args) => {
      prewarmed.push(args.question);
      return { warmed: 4, failed: 0, ms: 0 };
    }
  };
  return api;
}

// A minimal curated set, so the engine has something to fall back to.
const curatedSet = {
  id: 'curated',
  name: 'Curated',
  description: '',
  order: 1,
  questions: Array.from({ length: 5 }, (_, i) => ({
    id: `c${i}`,
    topic: 'Curated',
    difficulty: 'hard',
    text: `Curated question ${i}?`,
    options: ['a', 'b', 'c', 'd'],
    correct: 1,
    explanation: 'because'
  }))
};

function memoryStore() {
  const used = {};
  return {
    getUsed: (id) => used[id] || [],
    markUsed: (id, qid) => {
      used[id] = used[id] || [];
      if (!used[id].includes(qid)) used[id].push(qid);
    },
    resetUsed: (id) => {
      used[id] = [];
    }
  };
}

function engineWith(ai) {
  const built = createAiStacks({ topics: ['Kubernetes troubleshooting'], ai, log: silent });
  const sets = { curated: curatedSet, ...built.stacks };
  const order = ['curated', ...built.order];
  const engine = new GameEngine({
    sets,
    order,
    store: memoryStore(),
    winScore: 99,
    maxPlayers: 10,
    timerSeconds: 0
  });
  return { engine, built, sets, order };
}

test('stackIdFor slugs a topic into a stable stack id', () => {
  assert.equal(stackIdFor('Kubernetes troubleshooting'), 'ai-kubernetes-troubleshooting');
  assert.equal(stackIdFor('CI/CD & IaC'), 'ai-ci-cd-iac');
});

test('toEngineQuestion maps quiz-ai fields onto the engine shape', () => {
  const q = toEngineQuestion(generated(1), { stackId: 'ai-k8s', topic: 'Kubernetes' });
  assert.equal(q.text, generated(1).question);
  assert.equal(q.correct, 0);
  assert.equal(q.difficulty, 'hard');
  assert.equal(q.generated, true);
  assert.ok(q.id);
  assert.equal(q.question, undefined, 'the engine reads .text, not .question');
});

test('a generated stack appears alongside curated ones', () => {
  const { built } = engineWith(fakeAi());
  const stack = built.stacks['ai-kubernetes-troubleshooting'];
  assert.ok(stack);
  assert.equal(stack.ai, true);
  assert.match(stack.name, /^AI: /);
  assert.ok(stack.order >= 1000, 'generated stacks sort after curated ones');
});

test('the engine serves generated questions when a generated stack is selected', () => {
  const ai = fakeAi({ supply: 3 });
  const { engine } = engineWith(ai);

  engine.game.stackId = 'ai-kubernetes-troubleshooting';
  engine.game.phase = 'ready';
  engine._nextQuestion();

  assert.equal(engine.game.currentSetId, 'ai-kubernetes-troubleshooting');
  assert.equal(engine.game.current.generated, true);
  assert.match(engine.game.current.text, /Generated question/);
  assert.equal(engine.game.current.options.length, 4);
});

test('an exhausted buffer falls back to curated content instead of stalling', () => {
  const ai = fakeAi({ supply: 1 });
  const { engine } = engineWith(ai);
  engine.game.stackId = 'ai-kubernetes-troubleshooting';

  engine._nextQuestion();
  assert.equal(engine.game.current.generated, true);

  // Buffer empty from here on.
  engine._nextQuestion();
  assert.equal(engine.game.currentSetId, 'curated');
  assert.equal(engine.game.current.generated, undefined);
  assert.match(engine.game.current.text, /Curated question/);
});

test('reveal scores a generated question like any other', () => {
  const { engine } = engineWith(fakeAi());
  engine.game.stackId = 'ai-kubernetes-troubleshooting';
  engine._nextQuestion();

  engine.game.votes = { A: engine.game.current.correct, B: 3 };
  engine.reveal();

  assert.equal(engine.game.teams.A.score, 1);
  assert.equal(engine.game.teams.B.score, 0);
  assert.equal(engine.game.history.length, 1);
  assert.ok(engine.game.history[0].explanation, 'the static explanation reaches the recap');
});

test('used-tracking works unchanged for generated questions', () => {
  const { engine } = engineWith(fakeAi());
  engine.game.stackId = 'ai-kubernetes-troubleshooting';

  engine._nextQuestion();
  const first = engine.game.current.id;
  engine._nextQuestion();

  const used = engine.store.getUsed('ai-kubernetes-troubleshooting');
  assert.ok(used.includes(first));
  assert.equal(used.length, 2);
});

test('publicState reports a generated stack without pretending it is fixed', () => {
  const ai = fakeAi({ supply: 4 });
  const { engine } = engineWith(ai);
  engine.game.stackId = 'ai-kubernetes-troubleshooting';
  engine._nextQuestion();

  const state = engine.publicState('host');
  const stack = state.stacks.find((s) => s.id === 'ai-kubernetes-troubleshooting');

  assert.equal(stack.ai, true);
  assert.equal(stack.used, 1);
  assert.equal(stack.total, 4, 'asked so far plus what is still buffered');
  assert.equal(stack.tiers.hard, 1, 'tier counts grow as questions are written');
  assert.equal(state.totalQuestions, 4);
});

test('curated stacks are unaffected by the generated path', () => {
  const { engine } = engineWith(fakeAi());
  engine.game.stackId = 'curated';

  for (let i = 0; i < 5; i += 1) engine._nextQuestion();

  assert.equal(engine.game.currentSetId, 'curated');
  const state = engine.publicState('host');
  const stack = state.stacks.find((s) => s.id === 'curated');
  assert.equal(stack.ai, false);
  assert.equal(stack.total, 5);
  assert.equal(stack.tiers.hard, 5);
});

test('explanations are warmed as questions enter the buffer', () => {
  const ai = fakeAi();
  engineWith(ai);

  // The adapter must hand the queue an onEnqueue hook; the queue calls it for
  // every question it produces, well before that question reaches a player.
  const { onEnqueue } = ai.lastQueueOptions;
  assert.equal(typeof onEnqueue, 'function');

  const question = generated(42);
  onEnqueue(question);
  assert.deepEqual(ai.prewarmed, [question]);
});

test('the stack exposes queue health so a degraded session can say why', () => {
  const ai = fakeAi();
  const { built } = engineWith(ai);
  const stack = built.stacks['ai-kubernetes-troubleshooting'];

  assert.equal(stack.health(), null);
  ai.queue.health = { message: 'credentials rejected', fatal: true, retryInMs: null };
  assert.equal(stack.health().fatal, true);
});

test('a generation failure never propagates into the round', () => {
  const ai = fakeAi();
  engineWith(ai);
  const { onError } = ai.lastQueueOptions;

  assert.equal(typeof onError, 'function');
  assert.doesNotThrow(() => onError(Object.assign(new Error('401'), { fatal: true })));
});
