/* =====================================================================
   BOBCAT SCOUT — TEAM SETTINGS
   =====================================================================

   FILE LOCATION
       C:\Users\kishg\CLAUDE\bobcat-scout\team-config.js

   Fill this in once, for the whole team. Every scouter who opens the app
   gets these settings automatically and never sees a settings page.

   HOW TO EDIT
       Right-click this file, Open with, Notepad. Type your value between
       the two quote marks. Save. Then push (commands at the bottom).

   CHECK IT WORKED
       Open the app. If the SHEET button at the top is gone, it took.

   ---------------------------------------------------------------------
   FIRST, PICK HOW YOU LOCK IT DOWN
   ---------------------------------------------------------------------
   This repository is PUBLIC, so this file is public, and git history keeps
   it forever. That is fine — as long as the thing standing between a
   stranger and your spreadsheet is not written in here.

   ---- PLAN A: your school gives you Google accounts -------------------
   Easiest for everyone, and the most secure.

     In the Sheet's Config tab:
        Require Google Login  ->  yes
        Allowed Domain        ->  your school domain, e.g. team177.org
     In this file:
        put the passcode in, followed by   // PUBLISH-OK

   The passcode being public does not matter, because a stranger still
   cannot sign in with a school account. Scouters just open the plain
   link and sign in. Nothing else to send them.

   ---- PLAN B: everyone uses personal Gmail ---------------------------
   Use this if there is no school domain, or you do not know it.

     In the Sheet's Config tab:
        Require Google Login  ->  yes
        Allowed Domain        ->  leave blank
        Allowed Emails        ->  leave blank
        Passcode              ->  keep your passcode here
     In this file:
        leave  passcode  BLANK

   Then send your team an invite link that carries the passcode:

        python tools/make-invite-link.py

   Run that in YOUR OWN terminal, not in a chat window — it asks for the
   passcode and you do not want that sitting in a transcript. A scouter
   opens the link once and their phone remembers. A stranger who finds
   this repo has no passcode and cannot submit.

   Changed the passcode, or someone left the team? Update it in the Sheet,
   make a new link, and every old link stops working instantly.
   ===================================================================== */

window.TEAM_CONFIG = {

  // ===================================================================
  // 1. WHERE MATCHES GO          ** REQUIRED **
  // ===================================================================
  // Your Google Apps Script web app address. It ends in /exec.
  //
  // ALREADY HAVE A SPREADSHEET? You already have this address too:
  //     the Sheet  >  Extensions > Apps Script
  //     >  Deploy > Manage deployments   <-- NOT "New deployment"
  //     >  copy the Web app URL
  //
  // MAKING ONE FROM SCRATCH? Full click-by-click is in SETUP-ONCE.md,
  // Parts A and B. The short version:
  //     https://sheets.new  >  rename it
  //     Extensions > Apps Script  >  paste in apps-script/Code.gs
  //     save  >  run  firstTimeSetup  >  Allow
  //     Deploy > New deployment > gear > Web app
  //         Execute as:      Me
  //         Who has access:  Anyone      <-- must be Anyone
  //     Deploy  >  copy the Web app URL
  //
  // Safe to publish. "Anyone" only means a phone may knock on the door;
  // the script still checks every rule before it writes a row.
  // -------------------------------------------------------------------
  sheetUrl: 'https://script.google.com/macros/s/AKfycbz6aXksgsVBMshkKifAnvFGZoJSidxousfwGVwFnizArKy1zVI2GrdvtGpXkIppBgPi/exec',

  // ===================================================================
  // 2. PASSCODE
  // ===================================================================
  // Must match the Passcode cell in the Sheet's Config tab, exactly.
  //
  //   PLAN A  ->  paste it here and add   // PUBLISH-OK   after it
  //   PLAN B  ->  leave blank, send it with make-invite-link.py
  //
  // See the top of this file for which plan is which.
  // -------------------------------------------------------------------
  passcode: '',

  // ===================================================================
  // 3. THIS COMPETITION          (recommended)
  // ===================================================================
  // Pre-fills the event code so nobody mistypes it and splits your data
  // across two spellings. You change this for each new competition.
  //
  //   1. https://www.thebluealliance.com/events
  //   2. Pick the year, click your competition.
  //   3. The code is the end of the address bar:
  //          thebluealliance.com/event/2026ctwat
  //                                    ^^^^^^^^^
  //   4. Put the SAME code in the Sheet's Config tab > Active Event.
  //
  // Safe to publish. Leave blank to let scouters type it themselves.
  // -------------------------------------------------------------------
  eventKey: '',

  // ===================================================================
  // 4. AUTO TEAM NUMBERS         (recommended — biggest data-quality win)
  // ===================================================================
  // With this set, a scouter picks the match number and their starting
  // slot and the TEAM NUMBER FILLS ITSELF IN — no more fat-fingered team
  // numbers. It also unlocks real team names, official rankings, and the
  // accuracy check against real match results.
  //
  //   1. https://www.thebluealliance.com/account   (sign in)
  //   2. Scroll to  Read API Keys.
  //   3. Description:  Bobcat Scout      >  Add New Key
  //   4. Copy the long key, paste it below, and add   // PUBLISH-OK
  //
  // Publishing this one is a normal, low-risk choice: the key is free,
  // read-only, cannot change anything on The Blue Alliance, and you can
  // delete it any time on that same page. Make a key used ONLY by this
  // app so revoking it never breaks anything else.
  //
  // Prefer not to publish it? Leave blank and send it in the invite link
  // instead — make-invite-link.py carries it too.
  // -------------------------------------------------------------------
  tbaKey: '',

  // ===================================================================
  // 5. GOOGLE SIGN-IN            ** REQUIRED for Plan A and Plan B **
  // ===================================================================
  // Already filled in for you. This is a published OAuth client ID, not
  // a secret — it only works from this app's own web address, and who may
  // actually submit is decided by the Sheet's Config tab.
  //
  // It MUST stay set while the Sheet has Require Google Login = yes,
  // or every single match is rejected with "Google sign-in required".
  // -------------------------------------------------------------------
  googleClientId: '404429673783-0mue3sktcon2ca4v7fgjmn8iu8bqitpe.apps.googleusercontent.com'
};

/* =====================================================================
   AFTER YOU EDIT THIS FILE

   Check nothing private is about to go public:

       node tools/test-config.js

   Then publish:

       git add team-config.js
       git commit -m "Set team settings"
       git push

   GitHub Pages redeploys in a minute or two.

   Or just say in Claude Code: "commit and push my team-config changes".
   ===================================================================== */
