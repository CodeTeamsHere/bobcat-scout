/* =====================================================================
   BOBCAT SCOUT — TEAM SETTINGS
   =====================================================================

   Fill this in ONCE, for the whole team. Every scouter who opens the app
   then gets these settings automatically, and the in-app settings page
   disappears — there is nothing for anyone to type, paste, or get wrong.

   Step-by-step instructions for finding each value, with links:
       SETUP-ONCE.md

   Leave a value as an empty string to turn that feature off.

   ---------------------------------------------------------------------
   READ THIS BEFORE YOU PASTE ANYTHING IN
   ---------------------------------------------------------------------
   This file ships to the browser, and if the GitHub repository is public
   then this file is public too. Anyone who reads it can send rows to the
   Sheet. They still cannot open, read, or edit the Sheet itself — the
   Apps Script gate only ever writes validated rows — but they could push
   junk data in.

   Pick one:
     * Fine for us    — leave the repo public. Worst case is junk rows,
                        each stamped with a name, easy to spot and delete.
     * Lock it down   - set requireGoogleLogin in the Sheet's Config tab
                        and fill in googleClientId below, so only your
                        team's Google accounts can submit at all.

   The Blue Alliance key below is a personal read-only key tied to whoever
   made it. If this repo is public, generate a key just for this app so it
   can be revoked on its own.
   ===================================================================== */

window.TEAM_CONFIG = {

  // ---------------------------------------------------------------
  // 1. WHERE MATCHES GO  (required)
  // The Apps Script web app URL. Ends in /exec.
  // SETUP-ONCE.md - "Part A" and "Part B"
  // ---------------------------------------------------------------
  sheetUrl: '',

  // ---------------------------------------------------------------
  // 2. PASSCODE  (required)
  // Must match the Passcode cell in the Sheet's Config tab, exactly.
  // SETUP-ONCE.md - "Part C"
  // ---------------------------------------------------------------
  passcode: '',

  // ---------------------------------------------------------------
  // 3. THIS COMPETITION  (optional but recommended)
  // The event code, e.g. 2026ctwat. Pre-fills it for every scouter so
  // nobody mistypes it. Find yours on The Blue Alliance event page —
  // it is the last part of the address.
  // Leave blank to let scouters type it themselves.
  // ---------------------------------------------------------------
  eventKey: '',

  // ---------------------------------------------------------------
  // 4. AUTO TEAM NUMBERS  (optional, strongly recommended)
  // A free read API key from The Blue Alliance. With it, the team
  // number fills itself in from the match number and starting slot,
  // so nobody can fat-finger a team number.
  // SETUP-ONCE.md - "Part D"
  // ---------------------------------------------------------------
  tbaKey: '',

  // ---------------------------------------------------------------
  // 5. GOOGLE SIGN-IN LOCK  (optional, strictest)
  // Only fill this in if the Sheet's Config tab has
  // "Require Google Login" set to yes. The shared client ID below is
  // published and is not a secret; who may submit is controlled by the
  // allow-list in your own Sheet.
  // SETUP-ONCE.md - "Part E"
  // ---------------------------------------------------------------
  googleClientId: ''
};
