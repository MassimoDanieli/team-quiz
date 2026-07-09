#!/usr/bin/env node
'use strict';

// Question-set validator — the quality gate before any new batch lands.
// Usage: node scripts/validate-sets.js [questionsDir]
// Exit 0 = all good, 1 = failures. Warnings do not fail the build.
//
// Checks per set:
//   schema     — required fields, 4 options, correct index in range, unique question ids
//   tiers      — difficulty is one of VALID_TIERS (catch typos in new batches)
//   positions  — correct answers spread across A-D (no position over MAX_POS_SHARE)
//   length     — "longest answer is the correct one" bias (the playtest lesson)
//   duplicates — same normalised question text within or across sets
//   explanations — present and non-trivial
// Across sets: unique set ids, unique order values.

const fs = require('fs');
const path = require('path');

const DIR = process.argv[2] || path.join(__dirname, '..', 'questions');
const VALID_TIERS = ['medium', 'hard', 'pro']; // single line to change on a taxonomy rename
const MAX_POS_SHARE = 0.4; // fail if one position holds >40% of correct answers (sets of 20+)
const MAX_LONGEST_SHARE = 0.4; // fail if the correct answer is strictly longest >40% of the time
const MIN_EXPLANATION = 20; // chars; shorter is a warning

const failures = [];
const warnings = [];
const norm = (t) =>
  String(t)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const files = fs
  .readdirSync(DIR)
  .filter((f) => f.endsWith('.json'))
  .sort();
const seenSetIds = new Map();
const seenOrders = new Map();
const seenTexts = new Map();

for (const f of files) {
  const p = path.join(DIR, f);
  let d;
  try {
    d = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    failures.push(`${f}: invalid JSON — ${e.message}`);
    continue;
  }
  const tag = d.id || f;

  for (const k of ['id', 'name', 'description', 'order', 'questions']) {
    if (!(k in d)) failures.push(`${tag}: missing set field "${k}"`);
  }
  if (!Array.isArray(d.questions) || d.questions.length === 0) {
    failures.push(`${tag}: no questions`);
    continue;
  }
  if (seenSetIds.has(d.id))
    failures.push(`${tag}: duplicate set id (also in ${seenSetIds.get(d.id)})`);
  seenSetIds.set(d.id, f);
  if (seenOrders.has(d.order))
    warnings.push(`${tag}: order ${d.order} already used by ${seenOrders.get(d.order)}`);
  seenOrders.set(d.order, f);

  const qids = new Set();
  const posCount = [0, 0, 0, 0];
  let longestCorrect = 0;

  for (const q of d.questions) {
    const qtag = `${tag}/${q.id || '?'}`;
    for (const k of ['id', 'topic', 'text', 'options', 'correct']) {
      if (!(k in q)) failures.push(`${qtag}: missing "${k}"`);
    }
    if (qids.has(q.id)) failures.push(`${qtag}: duplicate question id`);
    qids.add(q.id);
    if (!Array.isArray(q.options) || q.options.length !== 4) {
      failures.push(`${qtag}: needs exactly 4 options`);
      continue;
    }
    if (!Number.isInteger(q.correct) || q.correct < 0 || q.correct > 3) {
      failures.push(`${qtag}: "correct" must be an integer 0-3`);
      continue;
    }
    if ('difficulty' in q && !VALID_TIERS.includes(q.difficulty)) {
      failures.push(
        `${qtag}: unknown difficulty "${q.difficulty}" (valid: ${VALID_TIERS.join('|')})`
      );
    }
    if (!q.explanation || String(q.explanation).trim().length < MIN_EXPLANATION) {
      warnings.push(`${qtag}: explanation missing or under ${MIN_EXPLANATION} chars`);
    }
    posCount[q.correct]++;
    const lens = q.options.map((o) => String(o).length);
    if (
      lens[q.correct] === Math.max(...lens) &&
      lens.filter((l) => l === lens[q.correct]).length === 1
    ) {
      longestCorrect++;
    }
    const key = norm(q.text);
    if (seenTexts.has(key)) {
      warnings.push(`${qtag}: near-duplicate text of ${seenTexts.get(key)}`);
    } else {
      seenTexts.set(key, qtag);
    }
  }

  const n = d.questions.length;
  if (n >= 20) {
    const worst = Math.max(...posCount);
    if (worst / n > MAX_POS_SHARE) {
      failures.push(
        `${tag}: answer-position bias — one position holds ${worst}/${n} (${Math.round((worst / n) * 100)}%); spread is A:${posCount[0]} B:${posCount[1]} C:${posCount[2]} D:${posCount[3]}`
      );
    }
    if (longestCorrect / n > MAX_LONGEST_SHARE) {
      failures.push(
        `${tag}: length bias — the correct answer is strictly longest in ${longestCorrect}/${n} (${Math.round((longestCorrect / n) * 100)}%)`
      );
    }
  }
  console.log(
    `${tag}: ${n} questions — positions A:${posCount[0]} B:${posCount[1]} C:${posCount[2]} D:${posCount[3]}, longest-correct ${Math.round((longestCorrect / n) * 100)}%`
  );
}

if (warnings.length) {
  console.log('\nWARNINGS:');
  for (const w of warnings) console.log('  ⚠ ' + w);
}
if (failures.length) {
  console.log('\nFAILURES:');
  for (const x of failures) console.log('  ✗ ' + x);
  process.exit(1);
}
console.log(`\nOK — ${files.length} sets validated.`);
