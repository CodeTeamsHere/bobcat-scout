# Bobcat Scout — Pilot Proposal

**FRC Team 177 · Bobcat Robotics · prepared for the 2026 preseason**

---

## The one line version

Bobcat Scout is a free, team-owned scouting app where a scouter can **talk** a match into the form instead of tapping it in, and every match lands in a private team spreadsheet that turns into team ratings, win predictions, and a ranked pick list.

It is built, it is live, and it costs nothing to run.

**We are not asking to replace the scouting system the team already uses. We are asking to run this next to it for one event and compare the two.**

---

## What we are actually asking for

| | |
|---|---|
| **The ask** | Two or three scouters run Bobcat Scout at one event, on the same matches as our normal scouting |
| **What normal scouting does** | Exactly what it does today. Nothing changes. Nothing is turned off |
| **What we get at the end** | Two records of the same matches, so we can compare speed and accuracy with real numbers instead of opinions |
| **Cost to try it** | The software is free. The only spend is headsets, about $34 each |
| **Risk if it fails** | None. Our existing data was never interrupted |

If it wins on the numbers, we expand it next event. If it does not, we stop and we have lost nothing but a few hours of one student's time, which is already spent.

---

## What it does

**1. A scouter talks, and the form fills itself.**
Say *"Team 177, four in auto, climbed high, driver was smooth"* and the app fills in the team number, the auto count, the endgame, and the driver rating. Nothing is submitted until the scouter looks at the filled form and confirms it.

**2. Every match goes into one spreadsheet the team owns.**
Scouters can send matches in. They cannot open the spreadsheet, read other people's rows, or edit anything. A gate in the middle checks the passcode, the event, the date, and the numbers before it writes a single row.

**3. The spreadsheet turns into decisions.**
Team ratings calculated from what teams actually do, win probability for upcoming matches, and a ranked pick list for alliance selection. It grades its own predictions against the real results from The Blue Alliance, so we can see how much to trust it.

**4. It rebuilds itself for next year's game.**
Upload the new game manual as a PDF. The app drafts the whole form and every point value from it. A human checks the numbers, taps apply, and the form, the spreadsheet, and the analytics all retune to the new game. No code, no developer.

**5. It works with no signal.**
It installs to a phone home screen like a normal app, works fully offline, and queues matches until signal comes back. Nothing is ever lost.

---

## What it is not

This section exists because the fastest way to lose a room is to oversell, so here is the honest list.

- **It does not replace a strategy lead.** It organizes what humans saw. It does not watch the field.
- **It does not require anyone to talk.** Every field is a normal box, dropdown, or counter. A scouter can type through an entire match and the spreadsheet cannot tell the difference.
- **It is not magic transcription.** Speech recognition gets words wrong sometimes. That is exactly why the app fills the form in front of you, badges everything it guessed, and waits for you to confirm before anything is sent.
- **It is not a paid product.** There is no subscription, no server we rent, and no company behind it that can shut it off.
- **It is not finished forever.** Like any team tool, someone has to own it. That is addressed below.

---

## Objections, and honest answers

These are the questions we expect, with real answers rather than sales answers.

### "We already have a scouting app that works."
Good. Keep using it. This pilot is designed so that both run at once on the same matches. At the end we compare the two datasets and decide with evidence. Nothing about this proposal asks the team to bet on an unproven tool.

### "Speech recognition will not work in a loud venue."
This is the single biggest real risk, and we should test it rather than argue about it. The mitigation is a close-talk headset, which is what pit crews and sportscasters use in exactly this environment. Without a headset, accuracy does drop in a packed venue. That is why headsets are the one thing this proposal actually asks the team to buy, and why the pilot is designed to measure it.

**The specific headset: the Logitech H390.** It is a wired USB headset with a noise cancelling boom microphone that sits right at the corner of your mouth, which is exactly the geometry that keeps crowd noise out. It runs about **$34 each**, list price $39.99. Three of them for a pilot is roughly **$100**. A full scouting squad of six is roughly **$200**. It is wired USB, so there is no pairing, no charging, and no battery to die halfway through qualifications, and it works on a laptop out of the box.

One practical note worth knowing before anyone reports it as a bug: the H390 has a **mute switch on the cable**. If a scouter says nothing appears on screen, that switch is the first thing to check. The app watches for this and says so on screen after a few seconds of silence.

### "Our scouters will not want to talk into a headset."
Then they should type, and the app works exactly the same. Voice is an option, not a requirement, and mixed teams work fine because both paths produce identical rows. It is also worth being specific about what "talking" means here. It is not play by play. It is one short sentence after the match ends, roughly five seconds, said quietly into a headset that nobody else can hear.

### "What if the AI fills something in wrong?"
Nothing is ever submitted straight from a voice line. The app fills the form on screen, puts a small badge on every value it guessed, and the scouter confirms or fixes it before it sends. There is also a sanity check that stops obviously impossible entries, like a score far outside anything possible in a match.

### "What happens when there is no wifi at the venue?"
The app is installed to the phone and works fully offline. Matches queue up and send themselves the moment signal returns. The QR code path works with no connection at all. The one honest limitation is that speech recognition itself needs a connection on most devices, so with no signal you type. Everything else keeps working.

### "Who can see our data?"
Only whoever owns the spreadsheet, which is a team account. Scouters have submit access and nothing else. They cannot open it, read it, or edit it. Every row records who sent it and when, so bad data is traceable to a person rather than a mystery.

### "What if the link leaks to another team?"
Four layers. The passcode has to match. The event key has to match. Optional date limits reject anything outside the competition window. And if we want it locked down hard, we can require a Google sign in so only accounts on our team's list can submit at all. On top of that, every row is stamped with the account that sent it, so anything strange is obvious.

### "Is our voice being recorded and sent somewhere?"
Honest answer, because someone will ask. The app uses the browser's built in speech recognition, the same thing that powers dictation on a phone keyboard. On Chrome and Android that means the audio is transcribed by Google's speech service. On iPhone it is Apple's. Bobcat Scout itself never stores audio, and only the resulting text and the confirmed form fields are saved. The content is match events, not anything personal. Anyone uncomfortable with that types instead and no audio leaves the phone at all.

### "This is one student's project. What happens when he graduates?"
This is a fair question and the most important one. Three answers:

1. **There is nothing to maintain.** It is plain HTML and JavaScript in the team's GitHub, with no build step, no server, no database, and no subscription. It is hosted free on GitHub Pages. If nobody touches it for two years, it still works.
2. **Changing it does not require code.** The form, the fields, the dropdowns, and the point values are all edited through a builder screen inside the app. A member who has never written a line of code can rebuild the whole thing for a new game.
3. **Handoff is part of the pilot.** By the end of preseason, at least two other members should have set it up from scratch themselves using the built in setup walkthrough. If only one person can run it, it is not a team tool and we should say so.

### "The game changes every year. Will it break?"
The parts that change every year are all in one configuration that the app can build for you from the game manual PDF. The scoring, the spreadsheet columns, and the analytics engine all read from that same configuration, so one update retunes everything. The parts that do not change, the voice input, the offline queue, the access gate, and the ratings math, stay the same.

### "How do we know the analytics are not just made up numbers?"
Two checks are built in. First, it holds back a quarter of the matches, predicts them from the rest, and reports how often it was right. Second, it compares its team ratings and its predictions against the official results and official rankings from The Blue Alliance, and shows the gap. If the model is bad at our event, the app tells us it is bad rather than hiding it.

### "How long does training take?"
There is a setup walkthrough built into the app. A scouter picks "I am a scouter," fills in a name and event code, tests the microphone, and runs one practice match. That is about two minutes and it happens once. Hosts get a separate walkthrough that copies the script, opens the right pages, and tests the connection live.

### "What does it actually cost?"
The software is free forever. Hosting is free. The Blue Alliance data is free. The only real cost is the headsets, at about $34 each for the Logitech H390. Three for a pilot is roughly $100, and a full squad of six is roughly $200. Phones are the ones scouters already have in their pockets, and there is nothing to renew next year.

### "Are we allowed to use this?"
It records our own observations of public matches and reads public data from The Blue Alliance's official API using a free key. Custom scouting apps are standard practice across FRC.

---

## How we decide, measurably

At the end of the pilot event we should be able to answer these with numbers, not feelings.

| Question | How we measure it |
|---|---|
| Is it faster? | Time from match end to a submitted row, both methods |
| Is it accurate? | Compare the two datasets against the official Blue Alliance scores for the same matches |
| Did we lose data? | Count of matches missing from each method |
| Did scouters actually like it? | Ask them. If nobody wants to use it, that is a real result |
| Is the pick list any good? | Compare the ranked list against what the alliance captains actually did |

**Suggested bar for expanding it:** it has to be at least as accurate as our current method and meaningfully faster, and the scouters who used it have to want to keep using it. Anything less and we stop.

---

## Suggested plan for preseason

1. **Demo to the leads.** Fifteen minutes. Show a live match entry by voice, show the row landing in the spreadsheet, show the pick list. Take the hard questions.
2. **Pick the pilot group.** Two or three scouters who are willing to be honest about whether it is worse.
3. **Buy the headsets.** Three Logitech H390 units, about $100 total, one per pilot scouter.
4. **Preseason training session.** Everyone runs the two minute in app walkthrough and does one practice match. No slides needed.
5. **Handoff.** At least two members other than the author set the whole thing up from scratch, so the team is not dependent on one person.
6. **First event.** Run it in parallel. Collect both datasets.
7. **Review after the event.** Bring the numbers from the table above to the leads and decide together.

---

## Try it right now

The app is live and free at **codeteamshere.github.io/bobcat-scout**

Open it, tap **⚡ SETUP**, choose **I am a scouter**, and run the practice match. It takes two minutes and does not require any account, any key, or any setup.

*Prepared by Krish Munukoti, Team 177.*
