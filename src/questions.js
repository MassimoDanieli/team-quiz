'use strict';

const fs = require('fs');
const path = require('path');

// Load all question-set files from a directory.
// Each file: { id, name, description, order, questions:[...] }
function loadSets(dir) {
  const sets = {};
  const list = [];
  // Skip dotfiles: macOS scp/tar can drop AppleDouble junk ("._foo.json")
  // next to the real files, and those are binary blobs, not JSON.
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && !f.startsWith('.'));
  for (const f of files) {
    const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const id = data.id || path.basename(f, '.json');
    const questions = data.questions || (Array.isArray(data) ? data : []);
    const TIERS = ['medium', 'hard', 'pro'];
    questions.forEach((q) => {
      q.difficulty = TIERS.includes(q.difficulty) ? q.difficulty : 'hard';
    });
    if (!questions.length) continue;
    const set = {
      id,
      name: data.name || id,
      description: data.description || '',
      order: typeof data.order === 'number' ? data.order : 999,
      questions
    };
    sets[id] = set;
    list.push(set);
  }
  if (!list.length) throw new Error('No question sets found in ' + dir);
  list.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  return { sets, order: list.map((s) => s.id) };
}

module.exports = { loadSets };
