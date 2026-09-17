# Set Bobcat Scout up once, for the whole team

You do this **one time**. After it, every scouter just opens the link and starts
scouting — no settings, no passcodes, no keys, nothing to get wrong. There is no
settings page for them to find, because it disappears as soon as this is filled in.

Everything you collect here goes into one file: **[`team-config.js`](team-config.js)**.

You need a Google account and about twenty minutes. Follow it in order.

---

## What you are collecting

| # | Value | Where it comes from | Required? |
|---|---|---|---|
| 1 | **Web app URL** | Your own Apps Script deployment (Part B) | Yes |
| 2 | **Passcode** | You invent it (Part C) | Yes |
| 3 | **Event key** | The Blue Alliance event page (Part D) | Recommended |
| 4 | **TBA read key** | thebluealliance.com account page (Part E) | Recommended |
| 5 | **Google client ID** | Already written for you (Part F) | Only for the strict lock |

---

## Part A — Make the spreadsheet and add the script

1. Open **<https://sheets.new>**. A blank Google Sheet appears.
2. Click the name in the top left where it says *Untitled spreadsheet* and rename it
   to something like **Bobcat Scouting 2026**.
   *Use the account you want to own the data. Whoever owns this sheet is the only
   person who can ever open it.*
3. In the top menu click **Extensions → Apps Script**. A code editor opens in a new tab.
4. Open **[`apps-script/Code.gs`](apps-script/Code.gs)** from this project and copy all of it.
5. Back in the Apps Script editor, click inside the code area, press **Ctrl+A**, press
   **Delete** so it is completely empty, then press **Ctrl+V** to paste.
   *(On a Mac use Command instead of Ctrl.)*
6. Click the **save** icon (the floppy disk) near the top.
7. Find the dropdown near the top that lists function names and choose **firstTimeSetup**,
   then click **Run**.
8. Google will ask for permission. Click **Review permissions** → pick your account →
   **Advanced** → **Go to (project name)** → **Allow**.
   *The warning screen is normal. Google shows it for any script that is not published
   in their store. This is your own script, in your own account, writing to your own sheet.*
9. Switch back to the spreadsheet tab. Two new tabs appear at the bottom: **Config** and **Data**.

---

## Part B — Publish it and get the web app URL  ← value #1

This is the step people get wrong most often. Match every dropdown exactly.

1. Back in the Apps Script tab, click **Deploy** (top right) → **New deployment**.
2. Click the **gear icon** next to "Select type" and choose **Web app**.
3. **Description:** `Bobcat Scout endpoint`
4. **Execute as:** `Me`
5. **Who has access:** `Anyone`
6. Click **Deploy**, then copy the **Web app URL**. It is long and ends in `/exec`.

> **Why "Anyone" is safe.** It only means a phone is allowed to knock on the door.
> It gives nobody access to your spreadsheet. The script still checks the passcode,
> the event, the dates and the numbers before it writes a single row, and it runs
> as you, not as them.

Paste that URL into `team-config.js` as **`sheetUrl`**.

**Changing it later?** Use **Deploy → Manage deployments → edit (pencil) → New version →
Deploy**. That keeps the same URL. Making a *new deployment* gives you a different URL
and you would have to update `team-config.js` again.

---

## Part C — Pick a passcode  ← value #2

1. In your spreadsheet, click the **Config** tab at the bottom.
2. Next to **Passcode** in column B, type a password, e.g. `bobcat26`.
   Scouters never type this. It is baked into the app for them.
3. While you are there:
   - **Active Event** — your event code, e.g. `2026ctwat`, or blank to accept any event.
   - **Start Date / End Date** — optional. Fill them in and the sheet only accepts
     data during your competition.

Paste the same passcode into `team-config.js` as **`passcode`**.
It has to match the Config tab exactly, including capital letters.

---

## Part D — Find your event key  ← value #3

1. Go to **<https://www.thebluealliance.com/events>** and pick the year.
2. Click your competition.
3. Look at the address bar. The last part is the event key:
   `thebluealliance.com/event/`**`2026ctwat`** → the key is `2026ctwat`.

Paste it into `team-config.js` as **`eventKey`**. Every scouter gets it pre-filled,
so nobody mistypes it and splits your data across two spellings.

---

## Part E — Get a Blue Alliance read key  ← value #4

This is the single best thing you can do for data quality. With it on, a scouter picks
the match number and their starting slot and the **team number fills itself in** — so
nobody can fat-finger a team number ever again. It also unlocks real team names,
official rankings, and the accuracy check against real results.

1. Go to **<https://www.thebluealliance.com/account>** and sign in (a Google account works).
2. Scroll to **Read API Keys**.
3. Type any description, e.g. `Bobcat Scout`, and click **Add New Key**.
4. Copy the long key it gives you.

Paste it into `team-config.js` as **`tbaKey`**. It is free, read-only, and cannot change
anything on The Blue Alliance.

---

## Part F — Optional: lock it to your team's Google accounts

Only do this if you want the strictest setup. It makes scouters sign in with Google
before anything they send is accepted, and stamps every row with the account that sent it.

1. In the spreadsheet's **Config** tab, set **Require Google Login** to `yes`.
2. Fill in **either**:
   - **Allowed Domain** — your school's email domain, e.g. `team177.org`, **or**
   - **Allowed Emails** — a comma separated list of exact addresses.
3. In `team-config.js`, set **`googleClientId`** to:

   ```
   404429673783-0mue3sktcon2ca4v7fgjmn8iu8bqitpe.apps.googleusercontent.com
   ```

   This client ID is published and is **not** a secret. Who may actually submit is
   controlled entirely by the allow-list in your own sheet.

> Sign-ins last about an hour. When one expires a scouter taps the button again and
> anything waiting sends itself. Nothing is ever lost.

---

## Part G — Fill in the file and publish

1. Open **[`team-config.js`](team-config.js)** and paste your values between the quotes.
2. Save, commit, and push. GitHub Pages redeploys in a minute or two.
3. Open the app. The **SHEET** button should now be gone — that is how you know the
   preset took effect.
4. Send your scouters the plain link. Nothing else.

---

## Read this before you publish

`team-config.js` ships to the browser. **If this GitHub repository is public, that file
is public too.** Anyone who reads it could send rows into your sheet. They still cannot
open, read, or edit the sheet itself — the script only ever writes validated rows — but
they could push junk data in.

Pick one and be deliberate about it:

| Choice | What it means |
|---|---|
| **Leave the repo public** | Worst case is junk rows, each stamped with a name and a time, easy to spot and delete. Fine for most teams. |
| **Do Part F as well** | Only your team's Google accounts can submit at all. This is the real fix. |
| **Make the repo private** | GitHub Pages from a private repo needs a paid plan, so you would need different hosting. |

The Blue Alliance key is tied to whoever created it. If the repo is public, make a key
just for this app so it can be revoked on its own without breaking anything else.

---

## Who does what, after setup

| | Host (you) | Scouter |
|---|---|---|
| Open and read the spreadsheet | Yes | **No** |
| Edit or delete rows | Yes | **No** |
| Send a match in | Yes | Yes, through the gate |
| Configure anything | Once, here | **Nothing, ever** |

A scouter's phone can only call the script and hand it one match. It is never given any
role on the spreadsheet. The script decides what gets written, so the sheet stays yours.

---

## Next year, or a new game

The season's form is **generated from your QRScout config**, so the two never drift apart —
same field codes, same option keys, which means a Bobcat Scout row drops straight into the
pipeline you already use.

1. Export the config from QRScout and save it over `reference\QRScout_config.json`.
2. Open `tools\from-qrscout.py` and update the **`SCORING`** block with the new game's point
   values. A script cannot read a game manual, so this part is on a human.
3. Run:

   ```bash
   python tools/from-qrscout.py
   node tools/test-parser.js
   node tools/test-analytics.js
   ```

4. Push. Every scouter gets the new form next time they open the app.

There is deliberately no in-app form editor. If each scouter could rebuild the fields on
their own phone, the columns would drift apart and the data would stop lining up.

**Full instructions for this and every other kind of change, including the exact words to
paste into Claude Code, are in [CHANGE-IT.md](CHANGE-IT.md).**

---

## Where the files live

```
C:\Users\kishg\CLAUDE\bobcat-scout
```

Paste that into the File Explorer address bar to jump straight there.

| File | What it is |
|---|---|
| `team-config.js` | **The settings.** Every value, with its links and click path written inside the file. |
| `IMPORTANT\` | The deck, the handouts, the proposal, the video. Everything you would hand to a person. |
| `CHANGE-IT.md` | How to change anything, with copy-paste prompts. |
| `reference\QRScout_config.json` | Your QRScout form. The source of truth for the fields. |
| `config.json` | Generated from the above. Do not hand-edit it. |
| `assets\field-layout.jpg` | The field diagram, kept locally so it still shows with no signal. |
