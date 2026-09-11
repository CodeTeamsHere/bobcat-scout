# Build the printable leave-behind version of PILOT-PROPOSAL.md.
from fpdf import FPDF
from fpdf.enums import XPos, YPos

MAROON = (123, 31, 43)
GOLD = (196, 151, 47)
CHAR = (31, 31, 31)
GRAY = (107, 107, 107)
CREAM = (250, 247, 240)
LINE = (222, 216, 205)

OUT = r'C:\Users\kishg\Downloads\Bobcat Scout - Pilot Proposal.pdf'


class Doc(FPDF):
    def header(self):
        if self.page_no() == 1:
            return
        self.set_font('Helvetica', 'B', 8)
        self.set_text_color(*GRAY)
        self.cell(0, 6, 'BOBCAT SCOUT  -  PILOT PROPOSAL', align='L')
        self.cell(0, 6, 'TEAM 177', align='R', new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        self.set_draw_color(*LINE)
        self.line(self.l_margin, self.get_y() + 1, self.w - self.r_margin, self.get_y() + 1)
        self.ln(5)

    def footer(self):
        self.set_y(-14)
        self.set_font('Helvetica', '', 8)
        self.set_text_color(*GRAY)
        self.cell(0, 6, 'codeteamshere.github.io/bobcat-scout', align='L')
        self.cell(0, 6, str(self.page_no()), align='R')


pdf = Doc(format='Letter', unit='mm')
pdf.set_auto_page_break(True, margin=20)
pdf.set_margins(18, 16, 18)
pdf.add_page()
W = pdf.w - pdf.l_margin - pdf.r_margin


def eyebrow(text):
    pdf.ln(3)
    pdf.set_font('Helvetica', 'B', 8)
    pdf.set_text_color(*GOLD)
    pdf.cell(0, 5, text.upper(), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.ln(0.5)


def h2(text):
    pdf.ln(3)
    pdf.set_font('Helvetica', 'B', 13)
    pdf.set_text_color(*MAROON)
    pdf.multi_cell(W, 6, text, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.ln(1)


def body(text, size=9.5, color=CHAR, gap=1.5):
    pdf.set_font('Helvetica', '', size)
    pdf.set_text_color(*color)
    pdf.multi_cell(W, 4.6, text, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.ln(gap)


def bullet(label, text):
    """Dash, bold lead-in, then body text that wraps to a single hanging indent."""
    pdf.set_font('Helvetica', '', 9.5)
    pdf.set_text_color(*CHAR)
    y0 = pdf.get_y()
    pdf.set_text_color(*MAROON)
    pdf.set_font('Helvetica', 'B', 9.5)
    pdf.cell(4, 4.6, '-')
    pdf.set_text_color(*CHAR)
    pdf.set_font('Helvetica', '', 9.5)
    pdf.set_xy(pdf.l_margin + 4, y0)
    pdf.multi_cell(W - 4, 4.6, '**' + label + '** ' + text.strip(),
                   markdown=True, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.ln(0.8)


def qa(question, answer):
    # don't leave a question stranded at the foot of a page
    pdf.set_font('Helvetica', '', 9.5)
    need = (len(pdf.multi_cell(W, 4.6, question, dry_run=True, output='LINES'))
            + min(3, len(pdf.multi_cell(W, 4.6, answer, dry_run=True, output='LINES')))) * 4.6 + 4
    if pdf.get_y() + need > pdf.h - 22:
        pdf.add_page()
    pdf.set_font('Helvetica', 'B', 9.5)
    pdf.set_text_color(*MAROON)
    pdf.multi_cell(W, 4.6, question, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.set_font('Helvetica', '', 9.5)
    pdf.set_text_color(*CHAR)
    pdf.multi_cell(W, 4.6, answer, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.ln(2.2)


def callout(title, text):
    pdf.ln(1)
    x0, y0 = pdf.l_margin, pdf.get_y()
    pdf.set_font('Helvetica', 'B', 9.5)
    th = 5
    pdf.set_font('Helvetica', '', 9.5)
    lines = pdf.multi_cell(W - 10, 4.6, text, dry_run=True, output='LINES')
    h = th + len(lines) * 4.6 + 6
    pdf.set_fill_color(*CREAM)
    pdf.set_draw_color(*GOLD)
    pdf.rect(x0, y0, W, h, style='DF')
    pdf.set_fill_color(*GOLD)
    pdf.rect(x0, y0, 1.6, h, style='F')
    pdf.set_xy(x0 + 5, y0 + 3)
    pdf.set_font('Helvetica', 'B', 9.5)
    pdf.set_text_color(*MAROON)
    pdf.cell(W - 10, th, title, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.set_x(x0 + 5)
    pdf.set_font('Helvetica', '', 9.5)
    pdf.set_text_color(*CHAR)
    pdf.multi_cell(W - 10, 4.6, text, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.set_y(y0 + h + 3)


def table(rows, widths, head=True):
    pdf.set_draw_color(*LINE)
    for i, row in enumerate(rows):
        bold = head and i == 0
        pdf.set_font('Helvetica', 'B' if bold else '', 9)
        heights = []
        for cell, w in zip(row, widths):
            heights.append(len(pdf.multi_cell(w - 4, 4.4, cell, dry_run=True, output='LINES')))
        h = max(heights) * 4.4 + 3
        if pdf.get_y() + h > pdf.h - 22:
            pdf.add_page()
        y0 = pdf.get_y()
        x = pdf.l_margin
        if bold:
            pdf.set_fill_color(*MAROON)
            pdf.rect(pdf.l_margin, y0, sum(widths), h, style='F')
        for cell, w in zip(row, widths):
            pdf.set_xy(x, y0 + 1.5)
            pdf.set_text_color(*((255, 255, 255) if bold else CHAR))
            pdf.multi_cell(w - 4, 4.4, cell, new_x=XPos.LMARGIN, new_y=YPos.TOP)
            x += w
        pdf.set_y(y0 + h)
        pdf.set_draw_color(*LINE)
        pdf.line(pdf.l_margin, pdf.get_y(), pdf.l_margin + sum(widths), pdf.get_y())
    pdf.ln(3)


# ------------------------------------------------------------------ cover
pdf.set_fill_color(*MAROON)
pdf.rect(0, 0, pdf.w, 46, style='F')
pdf.set_fill_color(*GOLD)
pdf.rect(0, 46, pdf.w, 1.6, style='F')
pdf.set_xy(pdf.l_margin, 12)
pdf.set_font('Helvetica', 'B', 8)
pdf.set_text_color(*GOLD)
pdf.cell(0, 5, 'FIRST ROBOTICS  -  TEAM 177  -  BOBCAT ROBOTICS', new_x=XPos.LMARGIN, new_y=YPos.NEXT)
pdf.set_x(pdf.l_margin)
pdf.set_font('Helvetica', 'B', 26)
pdf.set_text_color(255, 255, 255)
pdf.cell(0, 13, 'Bobcat Scout', new_x=XPos.LMARGIN, new_y=YPos.NEXT)
pdf.set_x(pdf.l_margin)
pdf.set_font('Helvetica', '', 11)
pdf.set_text_color(235, 220, 205)
pdf.cell(0, 7, 'A pilot proposal for the 2026 preseason', new_x=XPos.LMARGIN, new_y=YPos.NEXT)
pdf.set_y(56)

body('Bobcat Scout is a free, team-owned scouting app where a scouter can talk a match into the form '
     'instead of tapping it in. Every match lands in one private team spreadsheet that turns into team '
     'ratings, win predictions, and a ranked pick list. It is built, it is live, and it costs nothing to run.')

callout('This does not replace the scouting we already do.',
        'The ask is to run it beside our current system for one event, on the same matches, so we can '
        'compare the two with real numbers instead of opinions. If it does not win, we stop, and our '
        'existing data was never interrupted.')

eyebrow('What we are asking for')
table([
    ['The ask', 'Two or three scouters run Bobcat Scout at one event, on the same matches as our normal scouting'],
    ['Normal scouting', 'Does exactly what it does today. Nothing changes, nothing is turned off'],
    ['What we get', 'Two records of the same matches, so speed and accuracy are measured, not argued'],
    ['Cost to try it', 'The software is free. The only spend is headsets, about $34 each'],
    ['Risk if it fails', 'None. Our existing data was never interrupted'],
], [34, W - 34], head=False)

eyebrow('What it does')
bullet('A scouter talks and the form fills itself.',
       ' Say "Team 177, four in auto, climbed high" and the team number, auto count, and endgame fill in. '
       'Nothing is submitted until the scouter sees the filled form and confirms it.')
bullet('Every match goes into one spreadsheet the team owns.',
       ' Scouters can send matches in. They cannot open the sheet, read other rows, or edit anything. A gate '
       'checks the passcode, the event, the date, and the numbers before it writes a row.')
bullet('The spreadsheet turns into decisions.',
       ' Team ratings, win probability for upcoming matches, and a ranked pick list for alliance selection. '
       'It grades its own predictions against real Blue Alliance results, so we know how much to trust it.')
bullet('It rebuilds itself for next year\'s game.',
       ' Upload the new game manual as a PDF and it drafts the whole form and every point value. A human '
       'checks the numbers and taps apply. No code, no developer.')
bullet('It works with no signal.',
       ' Installs to a phone home screen, works fully offline, and queues matches until signal returns.')

eyebrow('What it is not')
body('This section exists because the fastest way to lose a room is to oversell.')
bullet('It does not replace a strategy lead.', ' It organizes what humans saw. It does not watch the field.')
bullet('It does not require anyone to talk.', ' Every field is a normal box, dropdown, or counter. A scouter '
       'can type through an entire match and the spreadsheet cannot tell the difference.')
bullet('It is not magic transcription.', ' Speech recognition gets words wrong sometimes. That is exactly why '
       'the app fills the form in front of you, badges everything it guessed, and waits for you to confirm.')
bullet('It is not a paid product.', ' No subscription, no rented server, no company behind it that can shut it off.')

eyebrow('Objections, and honest answers')

qa('"We already have a scouting app that works."',
   'Good. Keep using it. This pilot runs both at once on the same matches, and we decide afterwards with '
   'evidence. Nothing here asks the team to bet on an unproven tool.')

qa('"Speech recognition will not work in a loud venue."',
   'This is the single biggest real risk, and we should test it rather than argue about it. Close-talk '
   'headsets are the fix, which is what pit crews use in exactly this environment. Without one, accuracy '
   'does drop in a packed venue. That is why headsets are the one thing this proposal asks the team to buy. '
   'Specifically the Logitech H390: a wired USB headset with a noise cancelling boom mic, about $34 each. '
   'Three for a pilot is roughly $100, a full squad of six roughly $200. Wired means no pairing, no '
   'charging, and no battery to die halfway through qualifications. Note for whoever fields the first '
   'support question: the H390 has a mute switch on the cable, and the app now says so on screen when it '
   'has heard nothing for a few seconds.')

qa('"Our scouters will not want to talk into a headset."',
   'Then they type, and the app works the same. Mixed teams are fine because both paths write identical rows. '
   'It is also worth being specific about what talking means here. It is not play by play. It is one short '
   'sentence after the match ends, about five seconds, said quietly into a headset nobody else can hear.')

qa('"What if the AI fills something in wrong?"',
   'Nothing is submitted straight from a voice line. The app fills the form on screen, badges every value it '
   'guessed, and the scouter confirms or fixes it. A sanity check also blocks impossible entries.')

qa('"What happens when there is no wifi at the venue?"',
   'The app is installed on the phone and works fully offline. Matches queue and send themselves when signal '
   'returns. The honest limit is that speech recognition itself needs a connection on most devices, so with '
   'no signal you type. Everything else keeps working.')

qa('"Who can see our data, and what if the link leaks?"',
   'Only whoever owns the spreadsheet, which is a team account. Scouters have submit access and nothing else. '
   'A leaked link still has to pass the passcode, the event key, and optional date limits, and we can require '
   'a Google sign-in so only accounts on our list can submit at all. Every row is stamped with who sent it.')

qa('"Is our voice being recorded and sent somewhere?"',
   'Honest answer, because someone will ask. The app uses the browser\'s built-in speech recognition, the same '
   'thing that powers dictation on a phone keyboard, so on Chrome and Android the audio is transcribed by '
   'Google and on iPhone by Apple. Bobcat Scout itself never stores audio, and only the resulting text and the '
   'confirmed fields are saved. Anyone uncomfortable with that types instead, and no audio leaves the phone.')

qa('"This is one student\'s project. What happens when he graduates?"',
   'The most important question, and there are three answers. There is nothing to maintain, because it is plain '
   'HTML and JavaScript in the team GitHub with no server, no database, and no subscription. Changing it does '
   'not require code, because the form, the fields, and the point values are all edited through a builder screen '
   'inside the app. And handoff is part of the pilot: by the end of preseason at least two other members should '
   'have set it up from scratch themselves. If only one person can run it, it is not a team tool.')

qa('"How do we know the analytics are not just made up numbers?"',
   'Two checks are built in. It holds back a quarter of the matches, predicts them from the rest, and reports '
   'how often it was right. It also compares its ratings and predictions against the official results and '
   'rankings from The Blue Alliance. If the model is bad at our event, the app says so instead of hiding it.')

qa('"How long does training take, and what does it cost?"',
   'There is a setup walkthrough inside the app. A scouter enters a name and event code, tests the microphone, '
   'and runs one practice match. That is about two minutes, once. The software, the hosting, and the Blue '
   'Alliance data are all free. The headsets are the only real cost, about $34 each, and phones are the ones '
   'scouters already carry. Nothing renews next year.')

pdf.add_page()
eyebrow('How we decide, measurably')
body('At the end of the pilot event we should be able to answer these with numbers, not feelings.')
table([
    ['Question', 'How we measure it'],
    ['Is it faster?', 'Time from match end to a submitted row, both methods'],
    ['Is it accurate?', 'Compare both datasets against the official Blue Alliance scores for the same matches'],
    ['Did we lose data?', 'Count of matches missing from each method'],
    ['Did scouters like it?', 'Ask them. If nobody wants to use it, that is a real result'],
    ['Is the pick list good?', 'Compare the ranked list against what the alliance captains actually did'],
], [42, W - 42])

callout('Suggested bar for expanding it',
        'It has to be at least as accurate as our current method and meaningfully faster, and the scouters who '
        'used it have to want to keep using it. Anything less and we stop.')

eyebrow('Suggested plan for preseason')
steps = [
    ('Demo to the leads', 'Fifteen minutes. A live match entry by voice, the row landing in the spreadsheet, '
                          'and the pick list. Take the hard questions.'),
    ('Pick the pilot group', 'Two or three scouters who will be honest about whether it is worse.'),
    ('Buy the headsets', 'Three Logitech H390 units, about $100 total, one per pilot scouter.'),
    ('Preseason training', 'Everyone runs the two-minute walkthrough inside the app and does one practice match.'),
    ('Handoff', 'At least two members other than the author set the whole thing up from scratch.'),
    ('First event', 'Run it in parallel with normal scouting. Collect both datasets.'),
    ('Review afterwards', 'Bring the numbers from the table above to the leads and decide together.'),
]
for i, (t, d) in enumerate(steps, 1):
    y0 = pdf.get_y()
    pdf.set_fill_color(*MAROON)
    pdf.ellipse(pdf.l_margin, y0 + 0.4, 5.4, 5.4, style='F')
    pdf.set_xy(pdf.l_margin, y0 + 1.2)
    pdf.set_font('Helvetica', 'B', 8)
    pdf.set_text_color(255, 255, 255)
    pdf.cell(5.4, 4, str(i), align='C')
    pdf.set_xy(pdf.l_margin + 8, y0)
    pdf.set_font('Helvetica', 'B', 9.5)
    pdf.set_text_color(*CHAR)
    pdf.cell(0, 4.8, t, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.set_x(pdf.l_margin + 8)
    pdf.set_font('Helvetica', '', 9.5)
    pdf.set_text_color(*GRAY)
    pdf.multi_cell(W - 8, 4.4, d, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.ln(2)

pdf.ln(2)
y0 = pdf.get_y()
pdf.set_fill_color(*MAROON)
pdf.rect(pdf.l_margin, y0, W, 24, style='F')
pdf.set_xy(pdf.l_margin + 6, y0 + 4)
pdf.set_font('Helvetica', 'B', 11)
pdf.set_text_color(255, 255, 255)
pdf.cell(0, 6, 'Try it right now', new_x=XPos.LMARGIN, new_y=YPos.NEXT)
pdf.set_x(pdf.l_margin + 6)
pdf.set_font('Helvetica', '', 9.5)
pdf.set_text_color(235, 220, 205)
pdf.multi_cell(W - 12, 4.6,
               'codeteamshere.github.io/bobcat-scout   -   open it, tap SETUP, choose "I am a scouter", and run '
               'the practice match. Two minutes, no account, no key, no setup.',
               new_x=XPos.LMARGIN, new_y=YPos.NEXT)

pdf.output(OUT)
print('saved', OUT)
