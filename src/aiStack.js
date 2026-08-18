'use strict';

// Generated question stacks.
//
// quiz-ai writes questions on demand for a topic. This file is the only place
// that knows both sides: it turns a generated question into the shape the
// engine already understands, and presents a topic as a stack that looks like
// any other one in the list.
//
// Deliberately narrow. The engine gains one branch in _nextQuestion(); nothing
// else in the app knows these stacks are different. Consequences:
//
//   - the host picks a generated topic from the same dropdown as a curated set
//   - used-tracking, history, recap and the publicState counters work unchanged
//   - if generation is off, or fails, the app is exactly what it was before
//
// quiz-ai is ESM and this app is CommonJS, so it is loaded with a dynamic
// import at boot. That is also why init() is async while everything the engine
// calls at round time stays synchronous — the engine broadcasts on every state
// change and must never await.

const logger = require('./logger');

// Generated stacks sort after every curated one. loadSets() defaults a set
// without an explicit order to 999, so start above that.
const AI_STACK_ORDER_BASE = 1000;

/** Turn a topic into a stack id: "Kubernetes troubleshooting" -> "ai-kubernetes-troubleshooting". */
function stackIdFor(topic) {
  const slug = String(topic)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `ai-${slug}`;
}

/**
 * Convert a quiz-ai question into the engine's shape.
 *
 * quiz-ai: { id, question, options, correctIndex, explanation, topic, difficulty }
 * engine:  { id, text,     options, correct,      explanation, topic, difficulty }
 *
 * The id must be unique within the stack because store.markUsed() keys on it.
 * quiz-ai derives its id from a hash of the question text, so the same question
 * regenerated later collides deliberately rather than being asked twice.
 */
function toEngineQuestion(q, { stackId, topic }) {
  return {
    id: q.id || `${stackId}-${Date.now().toString(36)}`,
    topic: q.topic || topic,
    difficulty: q.difficulty || 'hard',
    text: q.question,
    options: q.options,
    correct: q.correctIndex,
    explanation: q.explanation || '',
    generated: true
  };
}

/**
 * @param {object} opts
 * @param {string[]} opts.topics   Topics to offer, from AI_TOPICS.
 * @param {object} opts.ai         A quiz-ai facade (injected in tests).
 * @param {object} [opts.log]
 */
function createAiStacks({ topics, ai, log = logger }) {
  const stacks = {};
  const order = [];

  topics.forEach((topic, i) => {
    const stackId = stackIdFor(topic);
    if (stacks[stackId]) return; // duplicate topic in the env var

    const queue = ai.createQueue({
      topic,
      difficulty: 'hard',
      bufferSize: 4,
      onError: (err) =>
        log.error({ err: err.message, topic, fatal: !!err.fatal }, 'ai: generation failed'),
      onEnqueue: (question) => {
        // Warm the explanations while the question sits in the buffer. Fire and
        // forget: a failure here costs a slower reveal, nothing more.
        ai.prewarm({ question }).catch(() => {});
      }
    });

    stacks[stackId] = {
      id: stackId,
      name: `AI: ${topic}`,
      description: `Questions written on demand for "${topic}". Falls back to a curated set if generation is unavailable.`,
      order: AI_STACK_ORDER_BASE + i,
      topic,
      ai: true,
      queue,

      // The engine treats sets[id].questions as an array for its counters. A
      // generated stack has no fixed contents, so this holds what has actually
      // been produced — which is what the "used / total" readout should show.
      questions: [],

      /**
       * Hand the engine the next generated question, or null when the buffer
       * is empty. Synchronous: the engine must not await inside a round.
       */
      take() {
        const { question, source } = queue.take();
        if (!question || source !== 'ai') return null;
        const engineQuestion = toEngineQuestion(question, { stackId, topic });
        this.questions.push(engineQuestion);
        return engineQuestion;
      },

      /** Whatever the queue knows, so the host UI can say why it degraded. */
      health() {
        return queue.health;
      }
    };

    order.push(stackId);
  });

  return {
    stacks,
    order,

    /**
     * Fill the buffers in the background. Never awaited by the caller: the
     * server must come up immediately, and an unprimed stack falls back to a
     * curated set rather than blocking.
     */
    prime() {
      for (const id of order) {
        stacks[id].queue.prime().then(
          (size) => log.info({ stackId: id, buffered: size }, 'ai: stack primed'),
          (err) => log.error({ stackId: id, err: err.message }, 'ai: prime failed')
        );
      }
    },

    stop() {
      for (const id of order) stacks[id].queue.stop();
    }
  };
}

/**
 * Load quiz-ai and build the stacks. Returns null when generation is off or
 * unavailable — the caller then runs exactly as it did before.
 */
async function initAiStacks({ topics, apiKey, model, log = logger }) {
  if (!topics.length) return null;
  if (!apiKey) {
    log.warn('ai: AI_TOPICS is set but ANTHROPIC_API_KEY is not — generated stacks disabled');
    return null;
  }

  let createQuizAI;
  try {
    ({ createQuizAI } = await import('quiz-ai'));
  } catch (err) {
    log.error({ err: err.message }, 'ai: could not load quiz-ai — generated stacks disabled');
    return null;
  }

  const ai = createQuizAI({ apiKey, ...(model ? { model } : {}) });
  const built = createAiStacks({ topics, ai, log });
  built.prime();
  log.info({ stacks: built.order.length, model: ai.client.model }, 'ai: generated stacks ready');
  return built;
}

module.exports = { createAiStacks, initAiStacks, toEngineQuestion, stackIdFor };
