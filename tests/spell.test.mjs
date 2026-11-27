import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findMisspellings, applyFix } from '../js/spell.js';

test('finds common misspellings and keeps case in suggestions', () => {
  const found = findMisspellings('Teh boss recieved alot of mail\nteh end');
  assert.deepEqual(found.map((f) => [f.word, f.fix, f.count]), [['Teh', 'The', 2], ['recieved', 'received', 1], ['alot', 'a lot', 1]]);
  assert.deepEqual(findMisspellings('A dog barks'), []);
});

test('applyFix replaces whole words only, every occurrence, matching case', () => {
  assert.equal(applyFix('teh Teh,TEH\nxteh tehx', 'teh'), 'the The,THE\nxteh tehx');
  assert.equal(applyFix('fine text', 'fine'), 'fine text');
});
