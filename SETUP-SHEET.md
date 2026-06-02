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

> **Note:** with passcode mode, anyone who has both the link **and** passcode could still submit.
> For most teams that's plenty. For the strongest option, use Google sign-in below.

---

## Optional: Auto-fill team numbers (The Blue Alliance)

So scouters don't type team numbers (and can't fat-finger them):

1. Get a free **Read API key** at <https://www.thebluealliance.com/account> (sign in → "Read API Keys" → add one).
2. In the app: **⚙ SHEET** → scroll to **Auto team numbers** → paste the key → make sure the **Event Key** in the form is set (e.g. `2026ctwat`) → **Load Match Schedule**.
3. Now when a scouter sets the match #, alliance, and station, the team number fills in automatically. The schedule is cached, so it keeps working offline.
4. The **Copy Scout Link** button includes the TBA key, so sharing one link sets this up for everyone.

---

## Optional: Maximum security — lock to your team's Google accounts

This requires scouters to sign in with Google, and only allowed accounts can submit. It's the most setup but the most secure.

**A. Create a Google OAuth Client ID (host, one time):**
1. Go to <https://console.cloud.google.com> → create a project (any name).
2. **APIs & Services → OAuth consent screen** → choose **Internal** (if your school has Google Workspace) or **External** → fill the app name + your email → Save.
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID** → Application type **Web application**.
4. Under **Authorized JavaScript origins**, add your site: `https://codeteamshere.github.io` (and `http://localhost:8000` if you test locally). **Create**.
5. Copy the **Client ID** (ends in `.apps.googleusercontent.com`).

**B. Configure the Sheet (Config tab):**
- **Require Google Login** → `yes`
- **Google Client ID** → paste the Client ID
- **Allowed Domain** → e.g. `team177.org` (only that email domain can submit) — *or* leave blank and use:
- **Allowed Emails** → a comma-separated list of exact emails

**C. Turn it on in the app:**
1. **⚙ SHEET** → **Google sign-in** → paste the same **Client ID** → **Save & Enable**.
2. Use **Copy Scout Link** — it now also carries the Client ID, so every scouter's app shows the Google button.
3. Each scouter taps **Sign in with Google** once (sign-ins last about an hour). Every saved row records the signed-in email.

> If both a passcode and Google login are set, the app uses both. Sign-ins expire ~hourly; scouters just tap the button again — queued matches send automatically afterward.
