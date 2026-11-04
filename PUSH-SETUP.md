# Turning on shift reminders (one time, about 15 minutes)

What you get: a scout who has the app installed and turned on **Remind me before my shift** gets a notification like
**"Your shift starts soon: Q12-15, Red 2"** about 3 matches before the shift, even when the app is closed.

Nothing here costs money. Until you finish these steps the app simply does not show the switch, and nothing else changes.

You need: this computer, the project folder `bobcat-scout`, and a Cloudflare login already set up
(if `node tools/deploy.js` has worked before, you are set).

## Part 1: open a terminal in the project folder

1. Open **File Explorer** and go to `C:\Users\kishg\CLAUDE\bobcat-scout`.
2. Click the address bar at the top, type `cmd`, press **Enter**. A black window opens. Every command below is typed there, then **Enter**.

## Part 2: make the keys (once)

3. Type `node tools/make-push-keys.js` and press Enter.
4. It prints a line starting `Public key (safe to share):` followed by a long text. **Select that long text and copy it** (right-click selects in this window, or drag over it, then right-click to copy).
   The private half goes straight into Cloudflare's secret store and is deleted from this computer. It is never shown.
   If it says Wrangler needs you to sign in, type `npx --yes wrangler@4 login`, click **Allow** in the browser, then run step 3 again.
5. Open `wrangler.jsonc` in Notepad (or VS Code). Find the line `"VAPID_PUBLIC": "",` and paste the key between the empty quotes, so it looks like `"VAPID_PUBLIC": "BKx...long...",`.
6. On the next line, change `"VAPID_SUBJECT": "mailto:CHANGE-ME@example.org"` to a real email of a team contact, for example `"mailto:coach@yourteam.org"`. (Push services use it only to reach you if the site misbehaves.)

## Part 3: the storage (already done)

The storage the reminders need (a Cloudflare KV store called PUSH) was already created and added to `wrangler.jsonc`. Nothing to do here. Go on to Part 4.

## Part 4: The Blue Alliance key (once)

9. Go to **https://www.thebluealliance.com/account** and sign in (make a free account if you need one).
10. Scroll to **Read API Keys**, type a description like `bobcat reminders`, click **Add New Key**, and copy the long key that appears.
11. In the black window type `npx --yes wrangler@4 secret put TBA_KEY` and press Enter. When it asks for the value, **paste the key yourself and press Enter**. (Nothing shows while you paste. That is normal.)

## Part 5: put it live

12. Type `node tools/deploy.js` and press Enter. It runs every test first, then uploads.
13. Check it worked: open `https://bobcat-scout.krishmunukotiishere.workers.dev/api/push/status` in a browser. You should see `"configured":true`. If it says `false`, one of these is missing: the public key in `wrangler.jsonc`, the PUSH storage, or the two secrets (`VAPID_PRIVATE` from step 4, `TBA_KEY` from step 11). Fix, then deploy again.

## Part 6: try it on a phone

14. The scouting lead publishes a rotation for the event (Analytics app), so the phone has shifts and shows the shift bar.
15. On the phone open the app, and under the shift bar tap **Remind me before my shift**. Tap **Allow** when the phone asks about notifications. The line "Reminders are on" appears.
16. A reminder only fires while The Blue Alliance has that event's schedule (and posts results), because that is how the server knows which match is up next. To test before an event, use a past event code that is still on TBA with a shift near the start: you will not get a reminder for it (its matches are all played), but the switch, permission and "Reminders are on" parts can still be checked.
17. To turn it off on one phone, tap the switch again.

### iPhone

Apple only allows web notifications for apps added to the Home Screen, on iOS 16.4 or newer.
In Safari tap **Share** (square with an arrow), **Add to Home Screen**, then open the app from the new icon and use the switch there.
The app tells scouts this if they try it in the browser.

### Android

Chrome works in the browser or as an installed app. If notifications are blocked, Settings, Apps (or Site settings), the app, Notifications, On.

## Turning it off for everyone

- Quick: delete the `"triggers": { "crons": [...] },` block in `wrangler.jsonc` and run `node tools/deploy.js`. Nothing is sent any more.
- Complete: also run `npx --yes wrangler@4 secret delete TBA_KEY` and `npx --yes wrangler@4 secret delete VAPID_PRIVATE`. The app then hides the switch by itself.

## Good to know

- Only the event code, the scout's first name (as typed in the app), the shifts and the phone's push address are stored, in the PUSH storage. Reminder text is always the fixed sentence above.
- The server checks The Blue Alliance every 2 minutes (once per event per 90 seconds) to learn the match number.
  A reminder is sent once per shift. If the phone is off, the push service holds it for 10 minutes.
- Phones not heard from for 30 days are forgotten; phones that opened the app recently refresh themselves. A push service that says a phone is gone removes it at once.
- Limits: 100 phones per event, 40 events. On Cloudflare's free plan one run sends at most 30 reminders; the rest go out 2 minutes later.
- Reminders follow The Blue Alliance's qualification schedule. If an event is not on TBA (or the schedule is not posted yet), no reminders go out.
