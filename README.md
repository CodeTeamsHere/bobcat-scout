# Bobcat Scout — REBUILT 2026

AI-powered voice scouting app for FRC Team 177 (Bobcat Robotics).

## What it does

Scouts at a competition open this app on their phone, tap the mic, and describe a match in natural language ("Match 14, team 177 red 2, scored 4 in auto, climbed level 2..."). The app auto-fills 25+ scouting fields, generates a scannable QR code matching the team's existing QRScout pipeline, and saves match data to a session spreadsheet.

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
- `app.js` — main logic (parser, voice, QR generation, session save)
- `config.json` — scouting field schema (edit to add or remove fields)
- `README.md` — this file

## Credits

Built for Team 177 Bobcat Robotics, South Windsor High School.
Designed to integrate with the [Bobcat QRScout](https://bobcatrobotics.github.io/QRScout/) scanning pipeline.
