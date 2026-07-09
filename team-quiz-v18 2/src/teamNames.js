'use strict';

const { shuffle } = require('./util');

const NAME_POOL = [
  'The Wobbly Bananas',
  'Soggy Biscuits',
  'Quacking Legends',
  'Noodle Squad',
  'The Flaming Penguins',
  'Caffeinated Llamas',
  'Rogue Pineapples',
  'The Grumpy Otters',
  'Disco Hedgehogs',
  'The Mighty Muffins',
  'Turbo Snails',
  'The Salty Walruses',
  'Confused Pigeons',
  'The Sleepy Narwhals',
  'Spicy Meatballs',
  'The Dancing Toasters'
];

function pickTwoNames() {
  const pool = shuffle(NAME_POOL);
  return [pool[0], pool[1]];
}

module.exports = { NAME_POOL, pickTwoNames };
