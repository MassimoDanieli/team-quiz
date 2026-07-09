'use strict';

// Persistence for "which questions have already been asked", tracked PER SET.
// Backed by an atomic JSON file. Small interface so it can be swapped for a DB later.
// File shape: { "usedByStack": { "<stackId>": ["q001", ...] } }

const fs = require('fs');
const path = require('path');

const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data', 'state.json');

function ensure() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) write({ usedByStack: {} });
}

function read() {
  ensure();
  try {
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (!raw.usedByStack) raw.usedByStack = {}; // migrate/ignore legacy shapes
    return raw;
  } catch (e) {
    return { usedByStack: {} };
  }
}

function write(obj) {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

module.exports = {
  getUsed(stackId) {
    return read().usedByStack[stackId] || [];
  },
  markUsed(stackId, id) {
    const s = read();
    s.usedByStack[stackId] = s.usedByStack[stackId] || [];
    if (!s.usedByStack[stackId].includes(id)) {
      s.usedByStack[stackId].push(id);
      write(s);
    }
  },
  resetUsed(stackId) {
    const s = read();
    s.usedByStack[stackId] = [];
    write(s);
  },
  filePath() {
    return DATA_FILE;
  }
};
