# Bobcat Scout — REBUILT 2026

Voice scouting app for FRC Team 177 (Bobcat Robotics).

## What it does

Scouts at a competition open this app on their phone, tap the mic, and describe a match in natural language ("Match 14, team 177 red 2, scored 4 in auto, climbed the mid rung..."). The app auto-fills the scouting fields and gives two ways to get the data out:

- **QR code** — the always-offline path (scan into the team's QRScout pipeline). Works with no internet.
- **Submit to Sheet** — optional one-tap auto-submit straight into a team Google Sheet when the phone has signal. It queues offline and sends automatically when back online, and is protected by a passcode + server-side validation + event/date gating + duplicate-blocking. See **[SETUP-ONCE.md](SETUP-ONCE.md)**.

## Getting started

Open the app and tap **⚡ SETUP**. It asks whether you are a scouter or the host, then walks you down a
numbered checklist — copying the Apps Script for you, opening the right Google pages, and sending a live
test row so you know the connection actually works. A scouter is done in about two minutes; a host in
about fifteen, once.

## Running the tests

The voice parser is the part that fails quietly — a pattern that stops matching does not
throw, it just leaves a field blank or fills the wrong one. There is a regression suite for it:

```bash
node tools/test-parser.js
node tools/test-analytics.js
```

Neither needs any dependencies and both run in under a second.

- **test-parser** covers the voice patterns, including the spelled-out numbers speech
  recognition returns and the false positives that used to fill the wrong field.
- **test-analytics** covers the scoring model. The engine is config-driven, so renaming a
  field in `config.json` makes the scoring silently become zero instead of throwing — these
  checks catch that, and verify the display columns still point at fields that exist.

Add a case whenever you touch a pattern in `parseTranscript` or a point value in `config.json`.

To run the app locally with no browser caching (so an edit shows up on reload):

```bash
python tools/devserver.py
```

**Setting it up for a team is a one-time job**, and it is all in
**[SETUP-ONCE.md](SETUP-ONCE.md)** — every value you need, where to click to get it, and
the links. Once the values are in [`team-config.js`](team-config.js), the in-app settings
page disappears and scouters have nothing to configure at all.

**To change anything later** — a new event, a new passcode, a new season — open
**[CHANGE-IT.md](CHANGE-IT.md)**. It says where each file is, what to do, and the exact
words to paste into Claude Code if you would rather not do it by hand.

**[IMPORTANT/](IMPORTANT/)** holds the finished things you would hand to a person: the pitch
deck, the scouter handout, the pilot proposal.

Other guides: **[HOW-TO-USE.md](HOW-TO-USE.md)** (roles and data flow),
**[PILOT-PROPOSAL.md](PILOT-PROPOSAL.md)** (the honest pitch for adopting it).

The scouting form is generated from the team's QRScout export
(`reference/QRScout_config.json`) by `tools/from-qrscout.py`, so the two stay
interchangeable — same field codes, same option keys. Do not hand-edit `config.json`.

It's an installable **PWA**: open it once and it runs fully offline (essential at venues — the QR library is bundled, not loaded from a CDN), the in-progress match auto-saves through refreshes, and you can **Add to Home Screen** to use it like an app.

Two modes (toggle at the top): **Match Scouting** (quantitative — auto/teleop/endgame) and **Pit Scouting** (qualitative — a robot's fixed capabilities, one row per team). Pit data routes to a separate **Pit** tab. The Sheet also auto-builds a live **Analytics** tab — a per-team info guide (matches, avg auto/teleop/total, climb %, avg driver/defense, reliability) that recomputes as data arrives; sort any column for a pick list.

The game changes every season, so the form is fully editable in-app: tap **🛠 FORM** to add/rename/reorder sections and fields (text, number, yes/no, dropdown, rating), then **Apply** — the boxes rebuild instantly, no code. The config is saved on the device; **Export JSON** to share the exact form with your scouts (they **Upload JSON**), or hand-edit/paste a config. `config.json` is just the built-in REBUILT 2026 default; a custom config in localStorage overrides it.

## Live URL

After deployment via GitHub Pages: `https://codeteamshere.github.io/bobcat-scout/`

## How to run locally (for testing changes before deploying)

This is a static site — no build step. To test locally:

1. Open the folder
2. Open `index.html` in a browser

Or, for the microphone to work (needs HTTPS or localhost), serve it with a tiny local server:

```
# Python (most computers have it):
python3 -m http.server 8000
# Then open http://localhost:8000 in your browser
```

## Deployment

See the deployment guide. Short version:

1. Push these files to the `main` branch of this repo
2. Settings → Pages → Source: Deploy from branch → main → / (root) → Save
3. Wait 1-2 minutes
4. Site is live at the GitHub Pages URL

## Files

- `index.html` — the page structure
- `styles.css` — all styling (Bobcat maroon/gold/white)
- `app.js` — main logic (parser, voice, QR generation, session save, Sheet submission + offline queue, walkthrough)
- `config.json` — scouting field schema (edit to add or remove fields)
- `vendor/qrcode-generator.js` — self-hosted QR library (bundled for offline use)
- `manifest.webmanifest` / `icon.svg` — PWA manifest + app icon (installable / Add to Home Screen)
- `service-worker.js` — caches the app shell so it runs fully offline after first load
- `apps-script/Code.gs` — the Google Apps Script that runs in the team Sheet (the submission endpoint)
- `SETUP-ONCE.md` — the one-time team setup: every value, where to click to get it, and the links
- `team-config.js` — the team's settings; filling it in hides the in-app settings page
- `README.md` — this file

## Credits

Built for Team 177 Bobcat Robotics, South Windsor High School.
Designed to integrate with the [Bobcat QRScout](https://bobcatrobotics.github.io/QRScout/) scanning pipeline.
