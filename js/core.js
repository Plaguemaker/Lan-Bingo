// Pure game logic: no DOM. Shared by the app and the Node tests.
//
// The key idea: a card is never sent anywhere. Every card is rebuilt from
// (game code + player name), so any device holding the game code can
// recreate and verify any player's card offline.

export const FORMAT_VERSION = 1;
export const MIN_SIZE = 3;
export const MAX_SIZE = 7;

// ---------- hashing and seeded randomness ----------

// cyrb53: small, fast, well-distributed 53-bit string hash.
export function hash53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

// mulberry32: tiny deterministic PRNG returning floats in [0, 1).
export function rng32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomSeed() {
  const bytes = new Uint8Array(6);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 10);
}

// ---------- game definition ----------

export function normalizeName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function parseStatements(text) {
  const seen = new Set();
  const out = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    // Strip list markers people paste in: "- ", "* ", "• ", "1. ", "2) "
    const s = raw.trim().replace(/^(?:[-*•]|\d+[.)])\s+/, '').trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

export function hasFreeCenter(game) {
  return !!game.f && game.n % 2 === 1;
}

export function cellsNeeded(size, free) {
  return size * size - (free && size % 2 === 1 ? 1 : 0);
}

// Returns a list of problems; empty list means the game is valid.
export function validateGame(game) {
  const problems = [];
  if (!Number.isInteger(game.n) || game.n < MIN_SIZE || game.n > MAX_SIZE) {
    problems.push(`Grid size must be between ${MIN_SIZE} and ${MAX_SIZE}.`);
  }
  const need = cellsNeeded(game.n, game.f);
  if (!Array.isArray(game.s) || game.s.length < need) {
    problems.push(`A ${game.n}×${game.n} card needs at least ${need} statements (you have ${game.s ? game.s.length : 0}).`);
  }
  if (!['line', 'full'].includes(game.w)) problems.push('Unknown win rule.');
  return problems;
}

export function createGame({ title, statements, size = 5, free = true, win = 'line', seed }) {
  const game = {
    v: FORMAT_VERSION,
    t: String(title || 'Bingo').trim() || 'Bingo',
    s: statements,
    n: size,
    f: !!free,
    w: win,
    k: seed || randomSeed(),
  };
  const problems = validateGame(game);
  if (problems.length) throw new Error(problems.join(' '));
  return game;
}

// An edited game keeps its original id (stored in `i`) so players, saved
// progress and Bingo calls all still point at the same game.
export function gameId(game) {
  if (game.i) return game.i;
  return hash53(JSON.stringify([game.k, game.n, game.f, game.w, game.s])).toString(36).slice(0, 8);
}

// The host fixes statements after players already have the game.
// Seed, grid size, free space and win rule stay the same, so:
// - same number of statements: every card keeps its exact layout and only the
//   wording changes (marks and Bingo calls stay valid);
// - different number: cards are reshuffled, and marks are carried over by text.
export function editGame(game, { title, statements }) {
  const edited = {
    ...game,
    t: String(title ?? game.t).trim() || 'Bingo',
    s: statements,
    i: gameId(game),
    r: (game.r || 0) + 1,
  };
  const problems = validateGame(edited);
  if (problems.length) throw new Error(problems.join(' '));
  return edited;
}

export function layoutKept(oldGame, newGame) {
  return oldGame.s.length === newGame.s.length && oldGame.k === newGame.k
    && oldGame.n === newGame.n && !!oldGame.f === !!newGame.f;
}

// Carry "happened" statement indexes over to an edited game.
export function migrateCalled(oldGame, newGame, called) {
  if (oldGame.s.length === newGame.s.length) return [...called].filter((i) => i < newGame.s.length);
  const byText = new Map(newGame.s.map((s, i) => [s.toLowerCase(), i]));
  return [...called].map((i) => byText.get(String(oldGame.s[i] || '').toLowerCase())).filter((i) => i !== undefined);
}

// Carry a player's marked cells over to an edited game.
export function migrateMarks(oldGame, newGame, playerName, marks) {
  if (layoutKept(oldGame, newGame)) return [...marks];
  const oldCard = makeCard(oldGame, playerName);
  const newCard = makeCard(newGame, playerName);
  const cellOf = new Map(newCard.map((si, c) => [si === -1 ? null : newGame.s[si].toLowerCase(), c]));
  const out = [];
  for (const c of marks) {
    const si = oldCard[c];
    if (si === undefined || si === -1) continue;
    const nc = cellOf.get(oldGame.s[si].toLowerCase());
    if (nc !== undefined) out.push(nc);
  }
  return out;
}

// ---------- CSV import ----------

// Minimal RFC 4180 CSV parser: quoted fields, "" escapes, commas/newlines in quotes.
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  const src = String(text || '').replace(/^\uFEFF/, '');
  // Excel in some locales saves with ";" and TSV uses tabs: pick by the first line.
  const first = src.split(/\r?\n/, 1)[0];
  const sep = first.includes(',') ? ',' : first.includes('\t') ? '\t' : first.includes(';') ? ';' : ',';
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else q = false;
      } else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const CSV_HEADER = /^(statements?|options?|items?|squares?|text|prompts?|bingo)$/i;

// Every non-empty cell becomes a statement (read row by row). A lone header
// like "Statement" or "Options" on the first row is skipped.
export function statementsFromCsv(text) {
  const rows = parseCsv(text).map((r) => r.map((c) => c.replace(/\s+/g, ' ').trim()).filter(Boolean)).filter((r) => r.length);
  if (rows.length && rows[0].every((c) => CSV_HEADER.test(c))) rows.shift();
  return rows.flat();
}

// ---------- cards ----------

// Returns an array of length n*n with statement indexes, or -1 for the free cell.
export function makeCard(game, playerName) {
  const key = normalizeName(playerName);
  if (!key) throw new Error('A player name is required.');
  const rand = rng32(hash53(`${game.k}|${key}`));
  const idx = game.s.map((_, i) => i);
  // Fisher-Yates shuffle
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  const total = game.n * game.n;
  const center = hasFreeCenter(game) ? (total - 1) / 2 : -1;
  const cells = [];
  let k = 0;
  for (let c = 0; c < total; c++) cells.push(c === center ? -1 : idx[k++]);
  return cells;
}

export function lines(size) {
  const out = [];
  for (let r = 0; r < size; r++) out.push(Array.from({ length: size }, (_, c) => r * size + c));
  for (let c = 0; c < size; c++) out.push(Array.from({ length: size }, (_, r) => r * size + c));
  out.push(Array.from({ length: size }, (_, i) => i * size + i));
  out.push(Array.from({ length: size }, (_, i) => i * size + (size - 1 - i)));
  return out;
}

// marks: Set of cell indexes. The free cell always counts as marked.
// Returns the winning lines (arrays of cell indexes); empty when no Bingo.
export function winningLines(game, marks) {
  const total = game.n * game.n;
  const center = hasFreeCenter(game) ? (total - 1) / 2 : -1;
  const isMarked = (c) => c === center || marks.has(c);
  if (game.w === 'full') {
    const all = Array.from({ length: total }, (_, c) => c);
    return all.every(isMarked) ? [all] : [];
  }
  return lines(game.n).filter((line) => line.every(isMarked));
}

// ---------- encoding helpers ----------

function bytesToB64url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlToBytes(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '==='.slice((b64.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pipe(bytes, stream) {
  const res = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}

const canCompress = () => typeof CompressionStream === 'function';

// Game codes: "1" + base64url(deflate-raw(json)), or "0" + base64url(json)
// when the browser has no CompressionStream.
export async function encodeGame(game) {
  const json = new TextEncoder().encode(JSON.stringify(game));
  if (canCompress()) {
    try {
      return '1' + bytesToB64url(await pipe(json, new CompressionStream('deflate-raw')));
    } catch { /* fall through to uncompressed */ }
  }
  return '0' + bytesToB64url(json);
}

export async function decodeGame(code) {
  const kind = code[0];
  let bytes = b64urlToBytes(code.slice(1));
  if (kind === '1') bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
  else if (kind !== '0') throw new Error('Unrecognised game code.');
  const game = JSON.parse(new TextDecoder().decode(bytes));
  if (game.v !== FORMAT_VERSION) throw new Error('This game was made with a different version of the app.');
  const problems = validateGame(game);
  if (problems.length) throw new Error(problems.join(' '));
  return game;
}

function encodeJson(obj) {
  return bytesToB64url(new TextEncoder().encode(JSON.stringify(obj)));
}
function decodeJson(str) {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(str)));
}

// Marks <-> compact base36 bitmask (fits: 7x7 = 49 bits < 2^53).
export function marksToString(marks) {
  let n = 0;
  for (const c of marks) n += 2 ** c;
  return n.toString(36);
}
export function stringToMarks(str) {
  let n = parseInt(str, 36) || 0;
  const out = new Set();
  for (let c = 0; n > 0; c++) {
    if (n % 2 === 1) out.add(c);
    n = Math.floor(n / 2);
  }
  return out;
}

// A Bingo claim: who is claiming and which squares they marked.
export function encodeClaim({ gid, name, marks, at }) {
  return encodeJson({ g: gid, p: name, m: marksToString(marks), at: at || Date.now() });
}
export function decodeClaim(str) {
  const o = decodeJson(str);
  return { gid: o.g, name: o.p, marks: stringToMarks(o.m), at: o.at };
}

// A result announced by the host after checking a claim.
export function encodeResult({ gid, title, winner, verified, at }) {
  return encodeJson({ g: gid, t: title, p: winner, ok: verified ? 1 : 0, at: at || Date.now() });
}
export function decodeResult(str) {
  const o = decodeJson(str);
  return { gid: o.g, title: o.t, winner: o.p, verified: !!o.ok, at: o.at };
}

// Pull "#g=", "#c=" or "#r=" payloads out of a scanned URL or a raw string.
export function parsePayload(text) {
  const m = String(text || '').match(/[#&?]([gcr])=([A-Za-z0-9_-]+)/);
  if (!m) return null;
  return { kind: { g: 'game', c: 'claim', r: 'result' }[m[1]], data: m[2] };
}

// Full verification of a claim against a game the verifier holds.
// called: Set of statement indexes the host has ticked as having happened
// (pass null to skip that check).
export function verifyClaim(game, claim, called) {
  const card = makeCard(game, claim.name);
  const wins = winningLines(game, claim.marks);
  const winCells = new Set(wins.flat());
  const uncalled = called
    ? [...winCells].filter((c) => card[c] !== -1 && !called.has(card[c])).map((c) => card[c])
    : [];
  return {
    card,
    wins,
    hasBingo: wins.length > 0,
    uncalled, // statement indexes in the winning line(s) not yet confirmed
    verified: wins.length > 0 && uncalled.length === 0,
  };
}
