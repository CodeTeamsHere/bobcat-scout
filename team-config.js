/* =====================================================================
   BOBCAT SCOUT — TEAM SETTINGS
   =====================================================================

   FILE LOCATION
       C:\Users\kishg\CLAUDE\bobcat-scout\team-config.js

   Fill this in ONCE, for the whole team. Every scouter who opens the app
   then gets these settings automatically and the in-app settings page
   disappears — there is nothing for anyone to type, paste, or get wrong.

   HOW TO EDIT IT
       Right-click this file in File Explorer, Open with, Notepad.
       Type your value between the two quote marks, e.g.
           passcode: 'bobcat26',
       Save. Then push it (see the end of this file).

   After you save and push, open the app. If the SHEET button at the top
   is GONE, the preset took effect. That is the only check you need.

   Longer walkthrough with screenshots-level detail: SETUP-ONCE.md
   Changing something later:                         CHANGE-IT.md

   ---------------------------------------------------------------------
   READ THIS BEFORE YOU PASTE ANYTHING IN
   ---------------------------------------------------------------------
   This file ships to the browser, and the GitHub repository is public,
   so this file is public too. Anyone who reads it could send rows to the
   Sheet. They still cannot open, read, or edit the Sheet itself — the
   Apps Script gate only ever writes validated rows — but they could push
   junk data in.

   Pick one on purpose:
     * Accept it   - worst case is junk rows, each stamped with a name
                     and a time, easy to spot and delete.
     * Lock it     - do step 5 below plus the Config tab settings, so
                     only your team's Google accounts can submit at all.
                     This is the real fix.
   ===================================================================== */

window.TEAM_CONFIG = {

  // ===================================================================
  // 1. WHERE MATCHES GO          ** REQUIRED **
  // ===================================================================
  // This is YOUR Google Apps Script web app address. It ends in /exec.
  //
  // FIRST TIME — make the spreadsheet and the script:
  //   1. Go to      https://sheets.new
  //      A blank Google Sheet opens. Rename it (click the name in the
  //      top left) to something like "Bobcat Scouting 2026".
  //   2. Top menu:  Extensions  >  Apps Script
  //      A code editor opens in a new browser tab.
  //   3. Open the file  apps-script/Code.gs  from this project folder,
  //      select all of it and copy it.
  //   4. In the Apps Script editor: click in the code, press Ctrl+A,
  //      press Delete, then press Ctrl+V to paste ours in.
  //   5. Click the save icon (the floppy disk).
  //   6. In the function dropdown at the top pick  firstTimeSetup
  //      then click  Run.
  //   7. Google asks for permission:
  //         Review permissions  >  pick your account  >  Advanced
  //         >  Go to (project name)  >  Allow
  //      The warning screen is normal. It is your own script, in your
  //      own account, writing to your own sheet.
  //   8. Back in the spreadsheet you now have two new tabs at the
  //      bottom:  Config  and  Data.
  //
  // THEN — publish it and copy the address:
  //   9. Apps Script tab:  Deploy (top right)  >  New deployment
  //  10. Click the gear icon next to "Select type", choose  Web app
  //  11. Description:      Bobcat Scout endpoint
  //      Execute as:       Me
  //      Who has access:   Anyone          <-- must be Anyone
  //  12. Click Deploy, then copy the Web app URL. Paste it below.
  //
  // "Anyone" only means a phone is allowed to knock on the door. It
  // gives nobody access to your spreadsheet.
  //
  // CHANGING IT LATER: use Deploy > Manage deployments > pencil icon >
  // New version > Deploy. That keeps the same address. Making a NEW
  // deployment gives a different address and you would have to update
  // this file again.
  // -------------------------------------------------------------------
  sheetUrl: 'https://script.google.com/macros/s/AKfycbz6aXksgsVBMshkKifAnvFGZoJSidxousfwGVwFnizArKy1zVI2GrdvtGpXkIppBgPi/exec',

  // ===================================================================
  // 2. PASSCODE                  ** REQUIRED **
  // ===================================================================
  // You invent this. Scouters never type it — it is baked in for them.
  //
  //   1. In your spreadsheet, click the  Config  tab at the bottom.
  //   2. In column B next to  Passcode , type a password.
  //      Example:  bobcat26
  //   3. Type the SAME thing below, exactly, capital letters included.
  //
  // While you are in the Config tab, also worth setting:
  //   Active Event  - your event code, e.g. 2026ctwat (or leave blank
  //                   to accept any event)
  //   Start Date / End Date - optional. Fill them in and the sheet only
  //                   accepts data during your competition.
  //
  // LEAVE THIS BLANK. This repository is public, so anything here is public,
  // and git history keeps it forever. The passcode travels in the invite link
  // instead — build one with:
  //
  //     python tools/make-invite-link.py
  //
  // Send that link to your scouters. Their phone stores the passcode the first
  // time they open it. Nobody who merely finds this repo can submit anything.
  //
  // Really want it published anyway? Put  // PUBLISH-OK  at the end of the line.
  // -------------------------------------------------------------------
  passcode: '',

  // ===================================================================
  // 3. THIS COMPETITION          (recommended)
  // ===================================================================
  // Pre-fills the event code for every scouter so nobody mistypes it
  // and splits your data across two spellings.
  //
  //   1. Go to      https://www.thebluealliance.com/events
  //   2. Pick the year, then click your competition.
  //   3. Look at the browser address bar. The last part is the code:
  //         thebluealliance.com/event/2026ctwat
  //                                   ^^^^^^^^^  this bit
  //
  // Leave blank to let scouters type it themselves.
  // You change this for each new competition.
  // -------------------------------------------------------------------
  eventKey: '',

  // ===================================================================
  // 4. AUTO TEAM NUMBERS         (recommended — biggest data-quality win)
  // ===================================================================
  // With this on, a scouter picks the match number and their starting
  // slot and the TEAM NUMBER FILLS ITSELF IN. Nobody can fat-finger a
  // team number again. It also unlocks real team names, official
  // rankings, and the accuracy check against real match results.
  //
  //   1. Go to      https://www.thebluealliance.com/account
  //      Sign in (a Google account works).
  //   2. Scroll down to  Read API Keys.
  //   3. In the description box type   Bobcat Scout
  //      Click  Add New Key.
  //   4. Copy the long key it shows you and paste it below.
  //
  // It is free, read-only, and cannot change anything on The Blue
  // Alliance. Because this repo is public, make a key just for this app
  // so it can be revoked on its own without breaking anything else.
  //
  // LEAVE THIS BLANK for the same reason as the passcode — it is tied to your
  // Blue Alliance account. It rides the invite link too, so scouters still get
  // automatic team numbers:
  //
  //     python tools/make-invite-link.py
  //
  // Really want it published? Make a key used ONLY by this app so you can
  // revoke it on its own, then put  // PUBLISH-OK  at the end of the line.
  // -------------------------------------------------------------------
  tbaKey: '',

  // ===================================================================
  // 5. GOOGLE SIGN-IN LOCK       (optional, strictest)
  // ===================================================================
  // Only do this if you want to guarantee that ONLY your team's Google
  // accounts can submit. It is the real answer to "this file is public".
  //
  //   1. In the spreadsheet's  Config  tab:
  //        Require Google Login  ->  yes
  //      and then EITHER
  //        Allowed Domain  ->  your school email domain, e.g. team177.org
  //      OR
  //        Allowed Emails  ->  a comma separated list of exact addresses
  //   2. Paste this exact value below (it is published, not a secret —
  //      your allow-list above is what actually controls access):
  //
  //        404429673783-0mue3sktcon2ca4v7fgjmn8iu8bqitpe.apps.googleusercontent.com
  //
  // Sign-ins last about an hour. When one expires a scouter taps the
  // button again and anything waiting sends itself. Nothing is lost.
  // -------------------------------------------------------------------
  googleClientId: '404429673783-0mue3sktcon2ca4v7fgjmn8iu8bqitpe.apps.googleusercontent.com'
};

/* =====================================================================
   AFTER YOU EDIT THIS FILE — publish it

   Open a terminal in  C:\Users\kishg\CLAUDE\bobcat-scout  and run:

       git add team-config.js
       git commit -m "Set team settings"
       git push

   GitHub Pages redeploys in a minute or two. Then open
   https://codeteamshere.github.io/bobcat-scout and check the SHEET
   button is gone.

   Or just ask in Claude Code: "commit and push my team-config changes".
   ===================================================================== */
