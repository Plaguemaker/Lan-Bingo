import * as core from './core.js';
import qrcode from '../vendor/qrcode.mjs';
import { startScanner } from './scanner.js';
import { findMisspellings, applyFix } from './spell.js';

const app = document.getElementById('app');
const BASE_URL = location.origin + location.pathname;
let stopScan = null;

// ---------- local storage (per device, survives going offline) ----------

const STORE_KEY = 'bingo:v1';
function loadStore() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY));
    if (s && s.games) return s;
  } catch { /* ignore */ }
  return { games: {}, lastName: '' };
}
let store = loadStore();
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch { /* private mode etc. */ }
}
function entry(gid) { return store.games[gid]; }
function upsert(gid, patch) {
  store.games[gid] = { marks: [], called: [], results: [], ...store.games[gid], ...patch, updated: Date.now() };
  save();
  return store.games[gid];
}

// ---------- tiny helpers ----------

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function qrSvg(text) {
  const qr = qrcode(0, text.length > 900 ? 'L' : 'M');
  qr.addData(text, 'Byte');
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 16, scalable: true, alt: 'QR code' });
}

function render(html) {
  if (stopScan) { stopScan(); stopScan = null; }
  app.innerHTML = html;
  window.scrollTo(0, 0);
}

function on(sel, evt, fn) {
  app.querySelectorAll(sel).forEach((el) => el.addEventListener(evt, fn));
}

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

async function share(url, title) {
  if (navigator.share) {
    try { await navigator.share({ title, url }); return; } catch { /* cancelled */ }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast('Link copied');
  } catch {
    prompt('Copy this link:', url);
  }
}

function header(title, back = true) {
  return `<header class="bar">
    ${back ? '<button class="ghost" data-nav="home" aria-label="Back to games">‹ Games</button>' : '<span></span>'}
    <h1>${esc(title)}</h1><span></span></header>`;
}

function bindNav() {
  on('[data-nav="home"]', 'click', () => home());
}

function qrBlock(url, caption) {
  return `<figure class="qr">${qrSvg(url)}<figcaption>${caption}</figcaption></figure>
    <div class="row"><button class="secondary" data-share>Share link</button></div>`;
}

// ---------- views ----------

function home() {
  const games = Object.entries(store.games).sort((a, b) => b[1].updated - a[1].updated);
  render(`${header('Bingo', false)}
  <main>
    <div class="stack">
      <button class="primary big" id="host">Host a new game</button>
      <button class="secondary big" id="scan">Scan a QR code</button>
      <p class="hint">Scan a game to join it, a Bingo call to check it, or a result to hear who won.</p>
    </div>
    ${games.length ? `<h2>Your games</h2><ul class="list">${games.map(([gid, e]) => `
      <li><button class="item" data-open="${gid}">
        <strong>${esc(e.game.t)}</strong>
        <span>${e.host ? 'Hosting' : 'Playing'}${e.name ? ` as ${esc(e.name)}` : ''}${e.results.length ? ` · ${e.results.at(-1).verified ? '🏆 ' + esc(e.results.at(-1).winner) : 'false call'}` : ''}</span>
      </button><button class="ghost small" data-del="${gid}" aria-label="Remove">✕</button></li>`).join('')}</ul>` : ''}
  </main>`);
  on('#host', 'click', () => hostSetup());
  on('#scan', 'click', () => scanView());
  on('[data-open]', 'click', (e) => openGame(e.currentTarget.dataset.open));
  on('[data-del]', 'click', (e) => {
    const gid = e.currentTarget.dataset.del;
    if (confirm(`Remove "${store.games[gid].game.t}" from this device?`)) {
      delete store.games[gid];
      save();
      home();
    }
  });
}

function openGame(gid) {
  const e = entry(gid);
  if (!e) return home();
  if (e.host) return hostGame(gid);
  if (e.name) return cardView(gid);
  return joinView(gid);
}

// editGid: when set, edit that hosted game's statements instead of creating a new one.
function hostSetup(prefill = {}, editGid = null) {
  const editing = editGid && entry(editGid);
  const orig = editing ? editing.game : null;
  if (orig) {
    prefill = { title: orig.t, statements: orig.s.join('\n'), size: orig.n, win: orig.w, free: orig.f };
  }
  const lock = orig ? 'disabled' : '';
  render(`${header(orig ? 'Edit statements' : 'New game')}
  <main>
    <form id="setup" class="stack">
      ${orig ? '<p class="hint">Fix typos or swap statements. Players keep their cards: if the number of statements stays the same, every square stays in place and only the wording changes. After saving, players scan the game code again to see the new wording.</p>' : ''}
      <label>Game name<input name="title" maxlength="60" value="${esc(prefill.title || '')}" placeholder="Office Bingo" spellcheck="true"></label>
      <label for="statements">Statements, one per line</label>
      <textarea id="statements" name="statements" rows="10" spellcheck="true" autocorrect="on" autocapitalize="sentences" lang="${esc(document.documentElement.lang || 'en')}" placeholder="Someone says &quot;you're on mute&quot;&#10;A dog barks&#10;The Wi-Fi drops">${esc(prefill.statements || '')}</textarea>
      <div class="row start">
        <button type="button" class="secondary small" id="upload">Upload CSV or text file</button>
        <input type="file" id="file" accept=".csv,.tsv,.txt,text/csv,text/plain,text/tab-separated-values" hidden>
      </div>
      <div id="spell" class="spell" aria-live="polite"></div>
      <p class="hint" id="count"></p>
      <div class="grid2">
        <label>Grid size
          <select name="size" ${lock}>${[3, 4, 5, 6, 7].map((n) => `<option value="${n}" ${n === (prefill.size || 5) ? 'selected' : ''}>${n} × ${n}</option>`).join('')}</select>
        </label>
        <label>To win
          <select name="win" ${lock}><option value="line">Any line</option><option value="full" ${prefill.win === 'full' ? 'selected' : ''}>Full card</option></select>
        </label>
      </div>
      <label class="check"><input type="checkbox" name="free" ${prefill.free === false ? '' : 'checked'} ${lock}> Free space in the centre (odd sizes)</label>
      ${orig ? '<p class="hint">Grid size, win rule and free space are fixed once a game has started, so existing cards stay valid.</p>' : ''}
      <p class="error" id="err" role="alert"></p>
      <button class="primary big" type="submit">${orig ? 'Save changes' : 'Create game'}</button>
      ${orig ? '<button class="secondary" type="button" id="cancel">Cancel</button>' : ''}
    </form>
  </main>`);
  bindNav();
  const form = app.querySelector('#setup');
  const box = form.statements;
  const update = () => {
    const n = core.parseStatements(box.value).length;
    const need = core.cellsNeeded(+form.size.value, form.free.checked);
    const el = app.querySelector('#count');
    let msg = `${n} statement${n === 1 ? '' : 's'} · each card needs ${need}${n < need ? ` (add ${need - n} more)` : n > need ? ', so every card gets a different mix' : ''}`;
    if (orig && n >= need && n !== orig.s.length) msg += `. You had ${orig.s.length}: changing the count reshuffles every card (marks on statements you kept carry over).`;
    el.textContent = msg;
    el.classList.toggle('warn', n < need);
    updateSpell();
  };
  const updateSpell = () => {
    const found = findMisspellings(box.value + '\n' + form.title.value);
    const el = app.querySelector('#spell');
    el.innerHTML = found.length ? `<span class="hint">Possible typos:</span> ${found.map((f) => `<button type="button" class="chip" data-fix="${esc(f.word)}" title="Replace ${f.count > 1 ? `all ${f.count}` : ''}">${esc(f.word)} → ${esc(f.fix)}</button>`).join('')}${found.length > 1 ? '<button type="button" class="chip all" data-fixall>Fix all</button>' : ''}` : '';
    el.querySelectorAll('[data-fix]').forEach((b) => b.addEventListener('click', () => {
      box.value = applyFix(box.value, b.dataset.fix);
      form.title.value = applyFix(form.title.value, b.dataset.fix);
      update();
    }));
    el.querySelectorAll('[data-fixall]').forEach((b) => b.addEventListener('click', () => {
      for (const f of found) {
        box.value = applyFix(box.value, f.word);
        form.title.value = applyFix(form.title.value, f.word);
      }
      update();
    }));
  };
  form.addEventListener('input', update);
  update();
  on('#cancel', 'click', () => hostGame(editGid));
  const file = app.querySelector('#file');
  on('#upload', 'click', () => file.click());
  file.addEventListener('change', async () => {
    const f = file.files[0];
    file.value = '';
    if (!f) return;
    const err = app.querySelector('#err');
    if (f.size > 1024 * 1024) { err.textContent = 'That file is over 1 MB. A Bingo list should be much smaller.'; return; }
    try {
      const text = await f.text();
      const added = /\.txt$/i.test(f.name) ? core.parseStatements(text) : core.statementsFromCsv(text);
      if (!added.length) { err.textContent = `No statements found in ${f.name}.`; return; }
      const before = core.parseStatements(box.value);
      const merged = core.parseStatements([...before, ...added].join('\n'));
      box.value = merged.join('\n');
      err.textContent = '';
      toast(`Added ${merged.length - before.length} statement${merged.length - before.length === 1 ? '' : 's'} from ${f.name}`);
      update();
    } catch {
      err.textContent = `Couldn't read ${f.name}.`;
    }
  });
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      const statements = core.parseStatements(box.value);
      if (orig) {
        const game = core.editGame(orig, { title: form.title.value, statements });
        const code = await core.encodeGame(game);
        const e = entry(editGid);
        const patch = { code, game, called: core.migrateCalled(orig, game, e.called) };
        if (e.name) patch.marks = core.migrateMarks(orig, game, e.name, e.marks);
        upsert(editGid, patch);
        toast('Saved. Ask players to scan the game code again.');
        return hostGame(editGid);
      }
      const game = core.createGame({
        title: form.title.value,
        statements,
        size: +form.size.value,
        free: form.free.checked,
        win: form.win.value,
      });
      const code = await core.encodeGame(game);
      const gid = core.gameId(game);
      upsert(gid, { code, game, host: true });
      hostGame(gid);
    } catch (err) {
      app.querySelector('#err').textContent = err.message;
    }
  });
}

function hostGame(gid, tab = 'share') {
  const e = entry(gid);
  const g = e.game;
  const url = `${BASE_URL}#g=${e.code}`;
  const called = new Set(e.called);
  const tabs = { share: 'Share', called: `Happened (${called.size})`, results: 'Bingo calls' };
  render(`${header(g.t)}
  <main>
    <nav class="tabs" role="tablist">${Object.entries(tabs).map(([k, v]) => `<button role="tab" aria-selected="${k === tab}" data-tab="${k}">${v}</button>`).join('')}</nav>
    ${tab === 'share' ? `
      ${qrBlock(url, `Players scan this to join. ${g.n}×${g.n}, ${g.s.length} statements, ${g.w === 'full' ? 'full card' : 'any line'} wins.`)}
      ${g.r ? `<p class="banner">Statements updated (version ${g.r + 1}). Players who joined earlier should scan this code again to see the new wording. Their cards and marks carry over.</p>` : ''}
      <p class="hint">Players only need this code once. After that the game works offline, so people can come and go.</p>
      <div class="row">${e.name
        ? `<button class="secondary" id="mycard">My card (${esc(e.name)})</button>`
        : '<button class="secondary" id="play">Play too</button>'}
        <button class="secondary" id="edit">Edit statements</button></div>
    ` : ''}
    ${tab === 'called' ? `
      <p class="hint">Tick statements as they happen. When someone calls Bingo, unticked squares in their line get flagged for you to confirm.</p>
      <ul class="checks">${g.s.map((s, i) => `<li><label class="check"><input type="checkbox" data-call="${i}" ${called.has(i) ? 'checked' : ''}> ${esc(s)}</label></li>`).join('')}</ul>
    ` : ''}
    ${tab === 'results' ? `
      <button class="primary big" id="scanclaim">Scan a Bingo call</button>
      ${e.results.length ? `<ul class="list">${e.results.slice().reverse().map((r) => `<li class="item static"><strong>${r.verified ? '🏆' : '✕'} ${esc(r.winner)}</strong><span>${r.verified ? 'Confirmed winner' : 'False call'} · ${new Date(r.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span></li>`).join('')}</ul>` : '<p class="hint">No Bingo calls yet.</p>'}
    ` : ''}
  </main>`);
  bindNav();
  on('[data-tab]', 'click', (ev) => hostGame(gid, ev.currentTarget.dataset.tab));
  on('[data-share]', 'click', () => share(url, g.t));
  on('#play', 'click', () => joinView(gid));
  on('#mycard', 'click', () => cardView(gid));
  on('#edit', 'click', () => hostSetup({}, gid));
  on('#scanclaim', 'click', () => scanView());
  on('[data-call]', 'change', (ev) => {
    const i = +ev.currentTarget.dataset.call;
    const set = new Set(entry(gid).called);
    ev.currentTarget.checked ? set.add(i) : set.delete(i);
    upsert(gid, { called: [...set] });
    app.querySelector('[data-tab="called"]').textContent = `Happened (${set.size})`;
  });
}

function joinView(gid) {
  const e = entry(gid);
  render(`${header(e.game.t)}
  <main>
    <form id="join" class="stack">
      <p>You're joining <strong>${esc(e.game.t)}</strong>. Your card is made from your name, so use the same name if you rejoin, and make sure nobody else in the game uses it.</p>
      <label>Your name<input name="name" required maxlength="40" autocomplete="nickname" value="${esc(store.lastName || '')}"></label>
      <button class="primary big" type="submit">Get my card</button>
    </form>
  </main>`);
  bindNav();
  app.querySelector('#join').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const name = ev.target.name.value.trim().replace(/\s+/g, ' ');
    if (!name) return;
    store.lastName = name;
    upsert(gid, { name, marks: [] });
    cardView(gid);
  });
  app.querySelector('input[name=name]').focus();
}

function cardGrid(game, card, marks, { interactive = false, highlight = new Set(), flagged = new Set() } = {}) {
  return `<div class="card" style="--n:${game.n}">${card.map((si, c) => {
    const free = si === -1;
    const cls = ['cell', free || marks.has(c) ? 'marked' : '', free ? 'free' : '', highlight.has(c) ? 'win' : '', flagged.has(c) ? 'flag' : ''].join(' ');
    const label = free ? 'FREE' : esc(game.s[si]);
    return interactive && !free
      ? `<button class="${cls}" data-cell="${c}" aria-pressed="${marks.has(c)}">${label}</button>`
      : `<div class="${cls}">${label}</div>`;
  }).join('')}</div>`;
}

function cardView(gid) {
  const e = entry(gid);
  const g = e.game;
  const card = core.makeCard(g, e.name);
  const marks = new Set(e.marks);
  const wins = core.winningLines(g, marks);
  const last = e.results.at(-1);
  render(`${header(g.t)}
  <main>
    ${last ? `<div class="banner ${last.verified ? 'good' : ''}">${last.verified ? `🏆 ${esc(last.winner)} won!` : `${esc(last.winner)}'s Bingo didn't check out. Game on.`}</div>` : ''}
    <p class="hint center">Playing as <strong>${esc(e.name)}</strong> · tap a square when it happens</p>
    ${cardGrid(g, card, marks, { interactive: true, highlight: new Set(wins.flat()) })}
    <div class="stack">
      <button class="primary big bingo" id="bingo" ${wins.length ? '' : 'disabled'}>BINGO!</button>
      <button class="secondary" id="scanres">Scan the host's result</button>
    </div>
  </main>`);
  bindNav();
  on('[data-cell]', 'click', (ev) => {
    const c = +ev.currentTarget.dataset.cell;
    const set = new Set(entry(gid).marks);
    set.has(c) ? set.delete(c) : set.add(c);
    upsert(gid, { marks: [...set] });
    const hadWin = wins.length > 0;
    cardView(gid);
    if (!hadWin && core.winningLines(g, set).length && navigator.vibrate) navigator.vibrate([80, 40, 80]);
  });
  on('#bingo', 'click', () => claimView(gid));
  on('#scanres', 'click', () => scanView());
}

function claimView(gid) {
  const e = entry(gid);
  const claim = core.encodeClaim({ gid, name: e.name, marks: new Set(e.marks) });
  const url = `${BASE_URL}#c=${claim}`;
  render(`${header('Bingo!')}
  <main>
    <p class="center">Show this to the host (or anyone in the game) so they can check your card.</p>
    ${qrBlock(url, `Bingo call from ${esc(e.name)}`)}
    <div class="stack"><button class="secondary" id="back">Back to my card</button></div>
  </main>`);
  bindNav();
  on('[data-share]', 'click', () => share(url, `Bingo from ${e.name}`));
  on('#back', 'click', () => cardView(gid));
}

function verifyView(claimStr) {
  let claim;
  try { claim = core.decodeClaim(claimStr); } catch { return errorView('That Bingo code is damaged. Ask the player to show it again.'); }
  const e = entry(claim.gid);
  if (!e) return errorView(`You don't have this game on this device yet. Scan the game's QR code first, then scan the Bingo call again.`);
  const g = e.game;
  const called = e.host ? new Set(e.called) : null;
  const v = core.verifyClaim(g, claim, called);
  const flagged = new Set([...new Set(v.wins.flat())].filter((c) => v.uncalled.includes(v.card[c])));

  let verdict;
  if (!v.hasBingo) verdict = `<div class="banner bad">✕ No Bingo. ${esc(claim.name)}'s marks don't complete ${g.w === 'full' ? 'the card' : 'a line'}.</div>`;
  else if (v.verified) verdict = `<div class="banner good">✓ Bingo checks out for ${esc(claim.name)}.</div>`;
  else if (called) verdict = `<div class="banner warn">${v.uncalled.length} square${v.uncalled.length === 1 ? '' : 's'} in the line haven't been ticked as happened. Confirm them below, or reject.</div>`;
  else verdict = `<div class="banner warn">The card and line are genuine. Only the host can confirm the statements actually happened.</div>`;

  render(`${header('Check Bingo')}
  <main>
    <p class="center"><strong>${esc(claim.name)}</strong> in ${esc(g.t)}</p>
    ${verdict}
    ${cardGrid(g, v.card, claim.marks, { highlight: new Set(v.wins.flat()), flagged })}
    ${called && v.hasBingo && !v.verified ? `<ul class="checks">${v.uncalled.map((si) => `<li><label class="check"><input type="checkbox" data-confirm="${si}"> ${esc(g.s[si])}</label></li>`).join('')}</ul>` : ''}
    ${e.host ? `<div class="stack">
      <button class="primary big" id="accept" ${v.verified ? '' : 'disabled'}>Announce ${esc(claim.name)} as winner</button>
      <button class="secondary" id="reject">Reject this call</button>
    </div>` : ''}
  </main>`);
  bindNav();
  on('[data-confirm]', 'change', (ev) => {
    const set = new Set(entry(claim.gid).called);
    const si = +ev.currentTarget.dataset.confirm;
    if (ev.currentTarget.checked) set.add(si); else set.delete(si);
    upsert(claim.gid, { called: [...set] });
    if (v.uncalled.every((x) => set.has(x))) verifyView(claimStr);
  });
  const announce = (verified) => {
    const r = { gid: claim.gid, title: g.t, winner: claim.name, verified, at: Date.now() };
    upsert(claim.gid, { results: [...entry(claim.gid).results, r] });
    resultShareView(r);
  };
  on('#accept', 'click', () => announce(true));
  on('#reject', 'click', () => announce(false));
}

function resultShareView(r) {
  const url = `${BASE_URL}#r=${core.encodeResult(r)}`;
  render(`${header('Result')}
  <main>
    <div class="banner ${r.verified ? 'good' : 'bad'} big">${r.verified ? `🏆 ${esc(r.winner)} wins!` : `${esc(r.winner)}'s call was rejected`}</div>
    ${qrBlock(url, 'Players scan this to get the result. Anyone who has it can show it to others.')}
  </main>`);
  bindNav();
  on('[data-share]', 'click', () => share(url, r.verified ? `${r.winner} won ${r.title}` : `${r.title}: false Bingo call`));
}

function receiveResult(str) {
  let r;
  try { r = core.decodeResult(str); } catch { return errorView('That result code is damaged.'); }
  const e = entry(r.gid);
  if (e && !e.results.some((x) => x.at === r.at && x.winner === r.winner)) {
    upsert(r.gid, { results: [...e.results, r] });
  }
  if (navigator.vibrate) navigator.vibrate(r.verified ? [200, 80, 200, 80, 400] : [150]);
  resultShareView(r);
}

async function joinFromCode(code) {
  try {
    const game = await core.decodeGame(code);
    const gid = core.gameId(game);
    const e = entry(gid);
    if (!e) upsert(gid, { code, game, host: false });
    else if ((game.r || 0) > (e.game.r || 0)) {
      // The host fixed the statements: take the new wording, keep this player's card and marks.
      const patch = { code, game, called: core.migrateCalled(e.game, game, e.called) };
      if (e.name) patch.marks = core.migrateMarks(e.game, game, e.name, e.marks);
      upsert(gid, patch);
      toast('The host updated the statements');
    }
    openGame(gid);
  } catch (err) {
    errorView(`Couldn't read that game: ${err.message}`);
  }
}

function errorView(msg) {
  render(`${header('Oops')}<main><p class="banner bad">${esc(msg)}</p></main>`);
  bindNav();
}

function scanView() {
  render(`${header('Scan')}
  <main>
    <div class="scanner"><video aria-label="Camera preview"></video><div class="frame"></div></div>
    <p class="hint center" id="scanmsg">Point the camera at a Bingo QR code.</p>
    <details><summary>Can't scan? Paste a link instead</summary>
      <form id="paste" class="stack"><input name="link" placeholder="https://…#g=…"><button class="secondary">Open</button></form>
    </details>
  </main>`);
  bindNav();
  const handle = (text) => {
    const p = core.parsePayload(text);
    if (!p) { app.querySelector('#scanmsg').textContent = "That QR code isn't from this Bingo app."; return false; }
    route(p);
    return true;
  };
  app.querySelector('#paste').addEventListener('submit', (ev) => {
    ev.preventDefault();
    handle(ev.target.link.value);
  });
  startScanner(app.querySelector('video'), (text) => {
    stopScan = null;
    if (!handle(text)) setTimeout(scanView, 1500);
  }).then((stop) => {
    if (app.querySelector('video')) stopScan = stop; else stop();
  }).catch((err) => {
    app.querySelector('#scanmsg').textContent = err.name === 'NotAllowedError'
      ? 'Camera access was blocked. Allow it in your browser settings, or paste a link below.'
      : err.message || 'Could not start the camera.';
    app.querySelector('details').open = true;
  });
}

function route(p) {
  if (p.kind === 'game') return joinFromCode(p.data);
  if (p.kind === 'claim') return verifyView(p.data);
  if (p.kind === 'result') return receiveResult(p.data);
}

// ---------- start ----------

function fromLocation() {
  const p = core.parsePayload(location.hash);
  if (p) {
    history.replaceState(null, '', location.pathname + location.search);
    route(p);
  } else {
    home();
  }
}
window.addEventListener('hashchange', fromLocation);
fromLocation();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
