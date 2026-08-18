'use strict';

// Persistence for generated questions.
//
// store.js remembers WHICH questions have been asked; this remembers WHAT the
// questions were. They are separate concerns and stay in separate files: a
// curated question already exists on disk in questions/, so only generated
// ones need writing down.
//
// Why bother: without this, every restart throws away everything the model
// wrote, and the next session pays to produce questions that are often the
// same ones. With it, a topic accumulates. After a dozen sessions a generated
// stack holds a real, de-biased question set that cost nothing to keep — and
// the engine prefers those over generating, so the running cost falls the more
// the stack is used.
//
// One file per stack, written atomically through a temp file and rename, the
// same convention store.js uses. Volumes are small (a few hundred questions,
// tens of KB) and writes happen when a question is generated, not per round,
// so a full rewrite is cheaper than the complexity of appending in place.

const fs = require('fs');
const path = require('path');
const logger = require('./logger');

// A stack that grew without bound would eventually slow the boot read and the
// unused-filter on every question. Well beyond any realistic cohort, but a
// limit that exists is better than one that does not.
const MAX_PER_STACK = 2000;

function fileFor(dir, stackId) {
  // stackId is built by stackIdFor(), which emits [a-z0-9-] only. Re-check
  // anyway: this value ends up in a path.
  if (!/^[a-z0-9-]+$/.test(stackId)) throw new Error(`unsafe stack id: ${stackId}`);
  return path.join(dir, `${stackId}.json`);
}

function createGeneratedStore({ dir, log = logger }) {
  function load(stackId) {
    let raw;
    try {
      raw = fs.readFileSync(fileFor(dir, stackId), 'utf8');
    } catch (err) {
      if (err.code !== 'ENOENT') {
        log.error({ err: err.message, stackId }, 'generated: could not read stack file');
      }
      return [];
    }

    try {
      const parsed = JSON.parse(raw);
      const questions = Array.isArray(parsed) ? parsed : parsed.questions;
      if (!Array.isArray(questions)) return [];
      // Anything malformed is dropped rather than allowed to reach a player.
      return questions.filter(isUsable);
    } catch (err) {
      log.error({ err: err.message, stackId }, 'generated: stack file is not valid JSON');
      return [];
    }
  }

  function save(stackId, questions) {
    const file = fileFor(dir, stackId);
    const tmp = `${file}.tmp`;
    const payload = {
      stackId,
      updatedAt: new Date().toISOString(),
      questions: questions.slice(-MAX_PER_STACK)
    };
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
      fs.renameSync(tmp, file);
      return true;
    } catch (err) {
      // A failed write must not break a running game: the question is already
      // in memory and will be served. It is only the accumulation that is lost.
      log.error({ err: err.message, stackId }, 'generated: could not persist stack');
      return false;
    }
  }

  return {
    load,
    save,

    /**
     * Add a question if its id is not already present.
     * @returns {boolean} true when the stack was written.
     */
    append(stackId, question, known) {
      if (!isUsable(question)) return false;
      if (known.some((q) => q.id === question.id)) return false;
      known.push(question);
      return save(stackId, known);
    },

    describe() {
      return dir;
    }
  };
}

// A persisted question has to satisfy exactly what the engine assumes when it
// serves one: four options and a correct index that points at one of them.
function isUsable(q) {
  return (
    q &&
    typeof q.id === 'string' &&
    typeof q.text === 'string' &&
    q.text.trim() !== '' &&
    Array.isArray(q.options) &&
    q.options.length === 4 &&
    q.options.every((o) => typeof o === 'string' && o.trim() !== '') &&
    Number.isInteger(q.correct) &&
    q.correct >= 0 &&
    q.correct < 4
  );
}

module.exports = { createGeneratedStore, isUsable, MAX_PER_STACK };
