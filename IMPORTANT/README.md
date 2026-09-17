# IMPORTANT — everything you need in one place

```
C:\Users\kishg\CLAUDE\bobcat-scout\IMPORTANT
```

Paste that into the File Explorer address bar to jump here.

If you are about to walk into a meeting, present to the team, or hand something to someone,
it is in this folder. Nothing in here is generated at runtime — these are finished files you
can email, print, or open on a screen.

---

## What is in here now

| File | What it is | Use it for |
|---|---|---|
| **Bobcat Scout - Pilot Proposal.pdf** | 3 pages. What it does, what it is *not*, every objection with an honest answer, how we measure success, the preseason plan. | Hand to Mr. Jarvis or a captain. Leave behind after a meeting. |
| **Bobcat Scout - Scouter Quick Start.pdf** | 1 page. Five steps, a QR code to the live app, what to do when something goes wrong. | Print one per scouter. Hand out at training. |
| **Bobcat Scout - Pitch Deck.pptx** | 11 slides. The problem, the fix, where the data goes, the payoff, what could go wrong, the ask. | Present to the leads. 10–15 minutes. |
| **Bobcat Scout - Launch Deck.pptx** | 12 slides, the visual/story version from Claude Design. | Background for the launch video, or a shorter hype version. |

---

## What still needs to go in here

**The launch video.** It lives in Claude Design, not on this computer. To get it in here:

1. Open your video in Claude Design.
2. Export or download it as an MP4.
3. Save it into this folder as `Bobcat Scout - Launch Video.mp4`.
4. If it is too big for GitHub (over 100 MB), upload it to Google Drive or YouTube unlisted
   instead and put the link in `LINKS.md` in this folder.

**A poster.** Not made yet. When you want one:

> **Say to Claude Code:** *"Make a one-page Bobcat Scout poster for the shop wall — big QR
> code to the app, the five steps, and 'you do not have to talk'. Put it in the IMPORTANT folder."*

---

## The links you will need

| | |
|---|---|
| **The live app** | <https://codeteamshere.github.io/bobcat-scout> |
| The code | <https://github.com/CodeTeamsHere/bobcat-scout> |
| Your scouting spreadsheet | *(paste the link here once it exists)* |
| The Blue Alliance events | <https://www.thebluealliance.com/events> |
| The Blue Alliance API keys | <https://www.thebluealliance.com/account> |
| New Google Sheet | <https://sheets.new> |

---

## The other documents, and when to read them

These live one folder up, in `C:\Users\kishg\CLAUDE\bobcat-scout`:

| File | Read it when |
|---|---|
| **CHANGE-IT.md** | You need to change something and don't remember how. Start here. |
| **SETUP-ONCE.md** | You are setting the whole thing up for the first time, or handing it to someone who is. |
| **team-config.js** | You need to change the event, the passcode, or a key. Instructions are inside the file. |
| **HOW-TO-USE.md** | You want to understand who can see what, and how a match gets from a phone into the spreadsheet. |
| **PILOT-PROPOSAL.md** | Same content as the PDF above, in text, if you want to edit the wording. |

---

## Regenerating the PDFs and the deck

If you change the wording, these are rebuilt by scripts rather than edited by hand:

```bash
cd C:\Users\kishg\CLAUDE\bobcat-scout\tools\handouts
python build_pilot_proposal.py
python build_quick_start.py
python build_pitch_deck_slides.py
```

They write into your `Downloads` folder. Copy the new versions back into this folder.

> **Say to Claude Code:** *"Rebuild the handouts and the deck and put the new copies in the
> IMPORTANT folder."*
