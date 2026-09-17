# Set Bobcat Scout up once, for the whole team

You do this **one time**. After it, every scouter just opens the link and starts
scouting — no settings, no passcodes, no keys, nothing to get wrong. There is no
settings page for them to find, because it disappears as soon as this is filled in.

Everything you collect here goes into one file: **[`team-config.js`](team-config.js)**.

You need a Google account and about twenty minutes. Follow it in order.

**Already made the spreadsheet in an earlier session?** Skip to [Already have a sheet?](#already-have-a-sheet-start-here-instead) — you do not need to redo any of this.

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

---

## Already have a sheet? Start here instead

If you already made the spreadsheet and ran the script in an earlier session, **do not
start over.** The script has not changed, so your deployment still works. You only need
four things, and it takes about five minutes.

### 1. Clear out the old Data tab

The scouting form changed, so the old columns no longer match. The script *appends*
columns it does not recognise rather than replacing them, so if you leave the old
headers there you end up with roughly eighty columns, half of them permanently blank.

1. Open the **Data** tab.
2. Check whether any rows are real scouting you care about. Test rows are not worth keeping.
3. Select all rows **including row 1, the header row**, right-click, **Delete rows**.
   The tab must be completely empty — the script rebuilds the header from the first match
   that arrives.

> Keeping old data? Right-click the Data tab, **Duplicate**, and rename the copy
> `Data (old 2026)` first. Then clear the real one.

### 2. Fix who is allowed to submit

This one will stop a pilot dead if you miss it. In the **Config** tab:

- If **Require Google Login** is `yes`, then **Allowed Emails** or **Allowed Domain**
  decides who can send matches. If Allowed Emails is just your own address, **every other
  scouter gets rejected.**
- Pick one:
  - **Allowed Domain** → your school's email domain, so anyone on it can submit. Easiest.
  - **Allowed Emails** → a comma separated list of every scouter's address.
  - Or set **Require Google Login** to `no` and rely on the passcode. Simplest for a pilot,
    but then anyone with the link can submit.

### 3. Set the event

In the **Config** tab, put your competition's code in **Active Event** (e.g. `2026ctwat`),
and put the same value in `team-config.js` as `eventKey`. Leave it blank to accept any event.

### 4. Get your web app URL

You already deployed the script, so the address already exists — you just need to read it.

1. Open the spreadsheet, then **Extensions → Apps Script**.
2. Top right: **Deploy → Manage deployments**.
3. Copy the **Web app URL** shown there. It ends in `/exec`.

Paste it into `team-config.js` as `sheetUrl`, and put your existing passcode (from the
Config tab) in as `passcode`. Then push.

> **Do not click "New deployment".** That creates a *second* address and leaves the old one
> live. Manage deployments shows you the one you already have.

### Tabs you can delete

`Pit` (pit scouting was removed) and `Sheet1` (the empty default) are both unused now.
Deleting them is optional and changes nothing.

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

## Deciding who is allowed to submit

There are three doors into your spreadsheet and you choose which ones are locked.
Here is what each setting actually does, so you can pick on purpose.

### The allow-list (Sheet → Config tab)

| Setting | Who can submit | Upkeep |
|---|---|---|
| **Allowed Domain** = your school's email domain | Anyone with a school account | None. Best option if your school uses Google |
| **Allowed Emails** = a list of addresses | Exactly those people | You edit the list when the roster changes |
| **Both blank** | **Anyone with any Google account** | None |

> **Both blank does not mean "only my team".** It means any Google account on
> Earth passes the check. It still stamps every row with the real email address
> that sent it, so junk is traceable and easy to delete — but it does not stop
> anyone.

### The passcode

If the passcode is published in this repository, it stops nobody, because anyone
can read it. Keep it out of the repo and send it in the invite link instead:

```bash
python tools/make-invite-link.py
```

That prints one link carrying the passcode and the Blue Alliance key. Send it to
your team privately. A scouter opens it once and their phone remembers both
values. Anyone who merely finds the repository has no passcode and cannot submit.

### What we recommend

**Leave the allow-list blank, and keep the passcode in the link.** You get:

- no email list to maintain as people join and leave,
- people you gave the link to can scout,
- someone who stumbles on the public repo cannot,
- and every row still records which Google account sent it.

If your school has Google accounts, setting **Allowed Domain** on top of that is
strictly better and costs nothing.

**Changed your mind, or someone left the team?** Change the passcode in the Sheet's
Config tab and send a new link. Every old link stops working immediately.

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
