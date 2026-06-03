# Bobcat Scout — REBUILT 2026

Voice scouting app for FRC Team 177 (Bobcat Robotics).

## What it does

Scouts at a competition open this app on their phone, tap the mic, and describe a match in natural language ("Match 14, team 177 red 2, scored 4 in auto, climbed the mid rung..."). The app auto-fills the scouting fields and gives two ways to get the data out:

- **QR code** — the always-offline path (scan into the team's QRScout pipeline). Works with no internet.
- **Submit to Sheet** — optional one-tap auto-submit straight into a team Google Sheet when the phone has signal. It queues offline and sends automatically when back online, and is protected by a passcode + server-side validation + event/date gating + duplicate-blocking. See **[SETUP-SHEET.md](SETUP-SHEET.md)**.

It's an installable **PWA**: open it once and it runs fully offline (essential at venues — the QR library is bundled, not loaded from a CDN), the in-progress match auto-saves through refreshes, and you can **Add to Home Screen** to use it like an app.

Two modes (toggle at the top): **Match Scouting** (quantitative — auto/teleop/endgame) and **Pit Scouting** (qualitative — a robot's fixed capabilities, one row per team). Pit data routes to a separate **Pit** tab. The Sheet also auto-builds a live **Analytics** tab — a per-team info guide (matches, avg auto/teleop/total, climb %, avg driver/defense, reliability) that recomputes as data arrives; sort any column for a pick list.

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
- `SETUP-SHEET.md` — click-by-click guide to connect the app to a Google Sheet
- `README.md` — this file

## Credits

Built for Team 177 Bobcat Robotics, South Windsor High School.
Designed to integrate with the [Bobcat QRScout](https://bobcatrobotics.github.io/QRScout/) scanning pipeline.
