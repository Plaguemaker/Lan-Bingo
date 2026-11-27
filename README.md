# Lan-Bingo

A lightweight, serverless Bingo game that runs in any phone or laptop browser and keeps working offline.

- **No server.** It is a folder of static files. Any static host works (GitHub Pages, Netlify, Cloudflare Pages).
- **No constant connection.** Players move in and out of range freely. Everything passes between devices by QR code (or a shared link) only at three moments: joining, calling Bingo, and announcing the result.
- **Configurable.** The host pastes statements (one per line, bullets and numbers are stripped), then picks grid size (3×3 to 7×7), free centre on or off, and "any line" or "full card" to win.

## How a game works

1. **Host** taps *Host a new game*, pastes statements and creates the game. A QR code appears.
2. **Players** scan it with their phone camera (or with the app's own scanner), enter their name and get a card. The game code holds the statement list and a random seed. Each card is built from *seed + player name*, so no card ever needs to be sent anywhere, and the app works offline from here on.
3. During the game the **host** can tick statements as they happen (*Happened* tab). Players tap squares on their own card.
4. When a player has a line, **BINGO!** shows a small "Bingo call" QR with their name and marked squares.
5. The **host** scans it. The app rebuilds that player's card from the game code, checks the line is real, and flags any square in the line the host hasn't ticked yet. The host confirms those and announces the winner, or rejects the call.
6. The host's **result QR** is scanned by players to get the result on their devices. Any player holding the result can show it to others, so it spreads even to people who were out of range.

**Fixing statements after the game has started.** The host taps *Edit statements* on the game's Share tab. The list comes back pre-filled, so a typo is a one-word fix. Grid size, win rule and free space are locked. If the number of statements stays the same, every card keeps its exact layout and only the wording changes; if it changes, cards are reshuffled and marks on statements that were kept carry over. Players scan the game code again to see the new wording. Until they do, their cards and Bingo calls still check out, because squares are matched by position, not by text.

**Typing help.** The statements box uses the browser's built-in spellcheck, and the app suggests one-tap fixes for common misspellings (offline, no dictionary download). Statements can also be loaded from a `.csv`, `.tsv` or `.txt` file: every non-empty cell becomes a statement, and a header like "Statements" or "Options" is skipped.

Because cards are recreated from the game code, a player can't fake a card, and anyone holding the game can check a claim.

Names matter: a player who rejoins with the same name gets the same card, and two players with the same name would share a card.

## Run locally

```sh
python3 -m http.server 8000   # then open http://localhost:8000
npm test                      # core logic tests (Node 18+)
```

The camera only works over `https://` or on `localhost`.

## Deploy

Upload the folder to any static host. For GitHub Pages: push to a repo, then Settings → Pages → deploy from the `main` branch, root folder.

When you change any file, bump `VERSION` in `sw.js` so installed copies pick up the update.

## Files

| Path | What it is |
| --- | --- |
| `js/core.js` | Game rules: seeded card generation, win checks, encoding of game, claim and result codes |
| `js/app.js` | The screens |
| `js/spell.js` | Offline common-misspelling suggestions for the statements box |
| `js/scanner.js` | Camera QR scanning (built-in detector where available, jsQR fallback) |
| `sw.js` | Offline cache |
| `vendor/` | [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) and [jsQR](https://github.com/cozmo/jsQR), both MIT/Apache licensed |
