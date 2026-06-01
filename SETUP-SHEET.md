# Connect Bobcat Scout to a Google Sheet (auto-submit)

This lets scouts send matches **straight into a Google Sheet** — no scanning needed —
while the QR code still works as an offline backup. Only people you give the link +
passcode to can submit, and the Sheet rejects anything that fails the checks.

You only do **Part A** once (the team lead, on the computer that owns the Sheet).
Each scout does the tiny **Part C** (or just opens a link you send them).

---

## Part A — Create the Sheet and its script (lead, one time)

1. Go to **https://sheets.google.com** and click the **＋ Blank spreadsheet**.
2. Rename it (top-left) to something like **Bobcat Scouting 2026**.
3. In the top menu, click **Extensions → Apps Script**. A code editor opens in a new tab.
4. Select everything in that editor (Ctrl+A) and delete it.
5. Open the file **`apps-script/Code.gs`** from this project, copy ALL of it, and paste it
   into the empty Apps Script editor.
6. Click the **save icon** (💾) at the top.
7. At the top of the editor there's a function dropdown — pick **`firstTimeSetup`**, then click **Run**.
   - The first time, Google shows a permission screen. Click **Review permissions →
     pick your Google account → Advanced → Go to (project name) → Allow**.
     (This is normal — it's your own script writing to your own Sheet.)
8. Switch back to your Sheet's tab. You'll now see two new tabs at the bottom: **Config** and **Data**.

## Part B — Set your passcode and event (lead)

1. Click the **Config** tab. Fill in column B:
   - **Passcode** — make up a password (e.g. `bobcat26`). Scouts' link will carry this.
   - **Active Event** — your event key (e.g. `2026ctwat`), or leave blank to allow any event.
   - **Start Date / End Date** — optional. Set them to only accept data during your event.
     Leave blank to allow any day.
2. Now publish the script as a web app. Go back to the **Apps Script** tab:
   - Click **Deploy → New deployment**.
   - Click the **gear icon ⚙ → Web app**.
   - **Description:** `Bobcat Scout endpoint`
   - **Execute as:** `Me`
   - **Who has access:** `Anyone`  ← important, or phones can't reach it
   - Click **Deploy**, then **copy the Web app URL** (it ends in `/exec`).

> Changing events later? Just edit the **Config** tab — no need to redeploy.

## Part C — Connect a phone

**Easiest (lead shares one link):**
1. Open the Bobcat Scout app, tap **⚙ SHEET** (top-right).
2. Paste the **Web app URL** and the **Passcode**, tap **SAVE**.
3. Tap **SEND TEST ROW** — you should see “✓ Success” and a `CONNECTION TEST` row appear
   in your Sheet's **Data** tab (delete that row afterward).
4. Tap **COPY SCOUT LINK** and send that link to your scouts (text, group chat, QR poster).
   When a scout opens it, their app connects automatically.

**Manual (per phone):** each scout taps **⚙ SHEET**, pastes the same URL + passcode, taps **SAVE**.

---

## How scouts use it

- Scout the match as normal → **GENERATE** → tap **SUBMIT TO SHEET** (or just **SAVE & NEXT**,
  which also submits when connected). A row lands in your Sheet instantly.
- **Keep going — one scouter scouts many matches.** Tap **SAVE & NEXT** and the form clears and the
  match number bumps up for the next match. There is **no per-scout limit**; every match is its own row.
- **No signal?** The app saves the match on the phone and shows a small **SHEET (n)** counter.
  As soon as the phone is back online it sends everything automatically — nothing is lost.
- **Still works without a Sheet at all:** the QR code is always there as the offline path.

## What's protected

| Guard | Effect |
|---|---|
| Passcode | Only apps carrying your passcode can submit. |
| Active Event / dates | Submissions outside your event (or its dates) are rejected. |
| Validation | Blank required fields or impossible numbers (bad team #, out-of-range scores) are rejected. |
| Duplicate-block | Only if the *same scout re-sends the same match & team* does it **update** that one row (prevents accidental doubles). Different matches/teams are always new rows — scouters report many matches each. |
| Stamping | Every row records the scout name and the submit time, so bad data is traceable. |

> **Note:** anyone who has both the link **and** passcode could still submit. For most teams
> this is plenty. If you ever need it locked to team members only, we can switch to Google
> sign-in restricted to your team.
