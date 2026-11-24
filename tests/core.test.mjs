import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../js/core.js';

const statements = Array.from({ length: 30 }, (_, i) => `Statement ${i + 1}`);
const base = () => core.createGame({ title: 'Test', statements, size: 5, free: true, seed: 'fixedseed1' });

test('parseStatements strips bullets, blanks and duplicates', () => {
  const got = core.parseStatements('- Someone sneezes\n\n* Dog barks\n1. Phone rings\n2) Phone rings\n• Coffee spilled\n  4 people late  ');
  assert.deepEqual(got, ['Someone sneezes', 'Dog barks', 'Phone rings', 'Coffee spilled', '4 people late']);
});

test('validation rejects too few statements', () => {
  assert.throws(() => core.createGame({ statements: statements.slice(0, 10), size: 5 }), /needs at least 24/);
  assert.doesNotThrow(() => core.createGame({ statements: statements.slice(0, 24), size: 5, free: true }));
  assert.throws(() => core.createGame({ statements: statements.slice(0, 24), size: 5, free: false }), /needs at least 25/);
});

test('cards are deterministic per name and differ between players', () => {
  const g = base();
  const a1 = core.makeCard(g, 'Alex');
  const a2 = core.makeCard(g, '  alex ');
  const b = core.makeCard(g, 'Bo');
  assert.deepEqual(a1, a2);
  assert.notDeepEqual(a1, b);
  assert.equal(a1.length, 25);
  assert.equal(a1[12], -1);
  const used = a1.filter((x) => x >= 0);
  assert.equal(new Set(used).size, 24);
});

test('different seeds give different cards for the same name', () => {
  const g1 = base();
  const g2 = { ...g1, k: 'otherseed' };
  assert.notDeepEqual(core.makeCard(g1, 'Alex'), core.makeCard(g2, 'Alex'));
});

test('even grids have no free cell', () => {
  const g = core.createGame({ statements, size: 4, free: true });
  assert.ok(core.makeCard(g, 'x').every((v) => v >= 0));
});

test('winning lines: rows, columns, diagonals, free centre', () => {
  const g = base();
  assert.equal(core.winningLines(g, new Set([0, 1, 2, 3])).length, 0);
  assert.equal(core.winningLines(g, new Set([0, 1, 2, 3, 4])).length, 1);
  assert.equal(core.winningLines(g, new Set([2, 7, 17, 22])).length, 1); // column through free centre
  assert.equal(core.winningLines(g, new Set([0, 6, 18, 24])).length, 1); // diagonal
  const full = { ...g, w: 'full' };
  assert.equal(core.winningLines(full, new Set([0, 1, 2, 3, 4])).length, 0);
  const all = new Set(Array.from({ length: 25 }, (_, i) => i));
  assert.equal(core.winningLines(full, all).length, 1);
});

test('game code round-trips and fits in a QR code', async () => {
  const long = Array.from({ length: 60 }, (_, i) => `Someone mentions the quarterly roadmap item number ${i}`);
  const g = core.createGame({ title: 'Big one', statements: long, size: 7 });
  const code = await core.encodeGame(g);
  assert.equal(code[0], '1');
  assert.deepEqual(await core.decodeGame(code), g);
  assert.ok(code.length < 2000, `code length ${code.length}`);
});

test('marks bitmask round-trips for 7x7', () => {
  const marks = new Set([0, 5, 24, 48]);
  assert.deepEqual(core.stringToMarks(core.marksToString(marks)), marks);
  assert.deepEqual(core.stringToMarks(core.marksToString(new Set())), new Set());
});

test('claim verification', () => {
  const g = base();
  const card = core.makeCard(g, 'Alex');
  const claim = core.decodeClaim(core.encodeClaim({ gid: core.gameId(g), name: 'Alex', marks: new Set([5, 6, 7, 8, 9]) }));
  const lineStatements = [5, 6, 7, 8, 9].map((c) => card[c]);

  const noneCalled = core.verifyClaim(g, claim, new Set());
  assert.ok(noneCalled.hasBingo);
  assert.equal(noneCalled.verified, false);
  assert.equal(noneCalled.uncalled.length, 5);

  const allCalled = core.verifyClaim(g, claim, new Set(lineStatements));
  assert.ok(allCalled.verified);

  const fake = core.verifyClaim(g, { ...claim, marks: new Set([0, 1, 2]) }, new Set(statements.map((_, i) => i)));
  assert.equal(fake.hasBingo, false);
  assert.equal(fake.verified, false);
});

test('parsePayload finds payloads in URLs', () => {
  assert.deepEqual(core.parsePayload('https://x.io/bingo/#g=1abc_-'), { kind: 'game', data: '1abc_-' });
  assert.deepEqual(core.parsePayload('https://x.io/#c=eyJ'), { kind: 'claim', data: 'eyJ' });
  assert.equal(core.parsePayload('hello'), null);
});

test('result round-trips', () => {
  const r = core.decodeResult(core.encodeResult({ gid: 'abc', title: 'T', winner: 'Alex', verified: true, at: 5 }));
  assert.deepEqual(r, { gid: 'abc', title: 'T', winner: 'Alex', verified: true, at: 5 });
});
