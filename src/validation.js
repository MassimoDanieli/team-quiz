'use strict';

const { NAME_MAX } = require('./config');

// Strip control chars, collapse whitespace, trim and length-cap a display name.
function cleanName(s, fallback = 'Player') {
  if (typeof s !== 'string') return fallback;
  const cleaned = s
    // eslint-disable-next-line no-control-regex -- intentional: strip control characters
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX);
  return cleaned || fallback;
}

function validAnswer(a) {
  return Number.isInteger(a) && a >= 0 && a <= 3;
}

module.exports = { cleanName, validAnswer };
