# How to change anything in Bobcat Scout

This is the page to open when you think *"I need to change X and I don't remember how."*
Every job below says where the file is in File Explorer, what to do, and — if you would
rather not do it yourself — **the exact words to paste into Claude Code**.

---

## Where everything lives

**The project folder is:**

```
C:\Users\kishg\CLAUDE\bobcat-scout
```

Paste that into the File Explorer address bar and press Enter to jump straight there.

| What | File | You edit this? |
|---|---|---|
| **Team settings** (sheet address, passcode, event, keys) | `team-config.js` | **Yes** — most changes are here |
| **Important stuff** (deck, handouts, proposal, video link) | `IMPORTANT\` folder | Yes — keep it stocked |
| The scouting form for this season | `config.json` | No — generated, see below |
| Your team's QRScout form (the source of truth) | `reference\QRScout_config.json` | Replace when QRScout changes |
| Form generator | `tools\from-qrscout.py` | Only for scoring values |
| The app itself | `app.js`, `index.html`, `styles.css` | No |
| Ratings, predictions, pick list | `analytics.js` | No |
| Google Sheet script | `apps-script\Code.gs` | No |
| One-time setup walkthrough | `SETUP-ONCE.md` | No |
| Tests | `tools\test-parser.js`, `tools\test-analytics.js` | No |

**The live app:** <https://codeteamshere.github.io/bobcat-scout>
**The code online:** <https://github.com/CodeTeamsHere/bobcat-scout>

---

## The jobs, in order of how often you will do them

### 1. New competition — change the event code

**Every event.** Takes a minute.

1. Get the code from <https://www.thebluealliance.com/events> — click your event, the code
   is the last part of the address bar (`thebluealliance.com/event/`**`2026ctwat`**).
2. Open `team-config.js`, set `eventKey: '2026ctwat'`.
3. Also update **Active Event** in the spreadsheet's **Config** tab so the gate matches.
4. Push it.

> **Say to Claude Code:**
> *"Change the event key in team-config.js to 2026ctwat, then commit and push."*

---

### 2. Change the passcode, the sheet address, or a key

1. Open `team-config.js`. Every value has the click-by-click steps written right above it,
   with the links.
2. Change the value between the quote marks.
3. Push it.

> **Say to Claude Code:**
> *"I have updated team-config.js. Commit and push it, and confirm the settings page is hidden."*

If you moved to a **different spreadsheet**, you also need a new web app address — see
`SETUP-ONCE.md` Part B.

---

### 3. The scouting form changed (QRScout was edited)

This is the important one, and it is why the app has no in-app form editor: everybody has
to be on the identical form or the columns stop lining up.

1. In QRScout, export the config JSON.
2. Save it over `reference\QRScout_config.json`.
3. Regenerate and check:

   ```bash
   python tools/from-qrscout.py
   node tools/test-parser.js
   node tools/test-analytics.js
   ```

4. Push it. Every scouter picks up the new form next time they open the app.

> **Say to Claude Code:**
> *"I have replaced reference/QRScout_config.json with the new export. Regenerate config.json,
> update the voice parser for any renamed fields, run both test suites, and push."*

---

### 4. New season, new game

Same as above plus the scoring, because a script cannot know what a game piece is worth.

1. Put the new QRScout export in `reference\QRScout_config.json`.
2. Open `tools\from-qrscout.py` and update the **`SCORING`** block near the top — points per
   game piece, what each climb level is worth, which checkboxes mean the robot broke.
3. Update **`DISPLAY`** in the same file so the ratings tables point at the new field names.
4. Regenerate, test, push.

> **Say to Claude Code:**
> *"New season. Here is the game manual and the new QRScout export. Rebuild config.json,
> set the scoring from the manual, update the voice parser and both test suites, and push.
> Tell me every point value you used so I can check it against the manual."*

You can attach the manual PDF to that message.

---

### 5. Voice is not picking something up

If a scouter says something and the wrong field fills in, or nothing fills in, that is a
parser pattern, not a settings problem.

> **Say to Claude Code:**
> *"When a scouter says '\<the exact sentence\>' the app fills in \<what it did\> but it should
> fill in \<what it should do\>. Fix the parser, add a test case for it, and push."*

The exact sentence matters more than anything else — paste what was actually said.

---

### 6. Something is broken and you are not sure what

> **Say to Claude Code:**
> *"Something is wrong with Bobcat Scout. \<describe what you saw\>. Run both test suites,
> check the app in the browser, find the cause and fix it."*

---

## Before an event — the five-minute check

1. Open the live app on a phone. The **SHEET** button should not be there.
2. Tap **⚡ SETUP**, run the practice match. The form should fill in.
3. Check the event code at the top matches the competition you are at.
4. Scout one practice match for real and confirm the row lands in the spreadsheet's **Data** tab.
5. Charge the phones and pack the headsets.

---

## Things that are deliberately not editable in the app

Worth knowing so you do not go looking for a button that is not there.

| | Why |
|---|---|
| No in-app form editor | If every scouter could rebuild the form on their phone, the columns would drift and the rows would stop lining up. One shipped form, same for everyone. |
| No settings page for scouters | Every key and address is set once, by you, in `team-config.js`. Nothing for a scouter to see or break. |
| No pit scouting | Removed. This is match scouting only. |

---

## If you are handing this over to someone else

Point them at this file and `SETUP-ONCE.md`, and have them do one thing before you leave:
**set the whole thing up from scratch themselves**, on their own Google account, following
`SETUP-ONCE.md`. If they cannot, the team is still depending on one person and that is the
actual risk — not the code.
