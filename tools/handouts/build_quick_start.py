# One-page scouter handout, matching the pilot proposal's look.
import qrcode
from fpdf import FPDF
from fpdf.enums import XPos, YPos

MAROON = (123, 31, 43)
GOLD = (196, 151, 47)
CHAR = (31, 31, 31)
GRAY = (107, 107, 107)
CREAM = (250, 247, 240)
LINE = (222, 216, 205)

APP = 'codeteamshere.github.io/bobcat-scout'
QR_PNG = 'qs_qr.png'
OUT = r'C:\Users\kishg\Downloads\Bobcat Scout - Scouter Quick Start.pdf'

qr = qrcode.QRCode(box_size=10, border=1, error_correction=qrcode.constants.ERROR_CORRECT_M)
qr.add_data('https://' + APP)
qr.make(fit=True)
qr.make_image(fill_color=(31, 31, 31), back_color=(255, 255, 255)).save(QR_PNG)

pdf = FPDF(format='Letter', unit='mm')
pdf.set_auto_page_break(False)
pdf.set_margins(16, 14, 16)
pdf.add_page()
W = pdf.w - pdf.l_margin - pdf.r_margin

# ---- header band
pdf.set_fill_color(*MAROON)
pdf.rect(0, 0, pdf.w, 40, style='F')
pdf.set_fill_color(*GOLD)
pdf.rect(0, 40, pdf.w, 1.6, style='F')
pdf.set_xy(pdf.l_margin, 10)
pdf.set_font('Helvetica', 'B', 8)
pdf.set_text_color(*GOLD)
pdf.cell(0, 5, 'TEAM 177  -  BOBCAT ROBOTICS', new_x=XPos.LMARGIN, new_y=YPos.NEXT)
pdf.set_x(pdf.l_margin)
pdf.set_font('Helvetica', 'B', 24)
pdf.set_text_color(255, 255, 255)
pdf.cell(0, 12, 'Scouter Quick Start', new_x=XPos.LMARGIN, new_y=YPos.NEXT)
pdf.set_x(pdf.l_margin)
pdf.set_font('Helvetica', '', 10)
pdf.set_text_color(235, 220, 205)
pdf.cell(0, 6, 'Everything you need for your first match. Takes about two minutes.',
         new_x=XPos.LMARGIN, new_y=YPos.NEXT)

# ---- QR panel on the right
QW = 42
qx = pdf.w - pdf.r_margin - QW
qy = 50
pdf.set_fill_color(*CREAM)
pdf.set_draw_color(*LINE)
pdf.rect(qx, qy, QW, QW + 16, style='DF')
pdf.image(QR_PNG, qx + 5, qy + 5, QW - 10, QW - 10)
pdf.set_xy(qx, qy + QW + 1)
pdf.set_font('Helvetica', 'B', 7.5)
pdf.set_text_color(*MAROON)
pdf.multi_cell(QW, 4, 'SCAN TO OPEN THE APP', align='C', new_x=XPos.LMARGIN, new_y=YPos.NEXT)
pdf.set_x(qx)
pdf.set_font('Helvetica', '', 7)
pdf.set_text_color(*GRAY)
pdf.multi_cell(QW, 3.4, 'codeteamshere.github.io\n/bobcat-scout', align='C',
               new_x=XPos.LMARGIN, new_y=YPos.NEXT)

# ---- steps
CW = W - QW - 8
pdf.set_xy(pdf.l_margin, qy)
pdf.set_font('Helvetica', 'B', 8)
pdf.set_text_color(*GOLD)
pdf.cell(CW, 5, 'FIVE STEPS', new_x=XPos.LMARGIN, new_y=YPos.NEXT)
pdf.ln(1)

steps = [
    ('Open the link your host sent you',
     'Or scan the code on the right. Then use your browser menu and Add to Home Screen so it opens like a normal app.'),
    ('Tap the SETUP button at the top',
     'Choose "I am a scouter". It asks for your name and the event code, tests your microphone, and runs one practice match with you.'),
    ('Describe the match out loud, or type it',
     'Tap the maroon mic and talk in plain English. "Team 177, four in auto, climbed high, driver was smooth." Typing works exactly the same.'),
    ('Tap AUTO-FILL FIELDS and check the form',
     'Anything the app guessed gets a small green AI badge. Tap any field to fix it. Fields with a red star are required.'),
    ('Tap SAVE AND NEXT MATCH',
     'It saves, sends it to the team spreadsheet, and bumps the match number for you. Repeat for every match, all day.'),
]
for i, (t, d) in enumerate(steps, 1):
    y0 = pdf.get_y()
    pdf.set_fill_color(*MAROON)
    pdf.ellipse(pdf.l_margin, y0 + 0.6, 6.4, 6.4, style='F')
    pdf.set_xy(pdf.l_margin, y0 + 1.6)
    pdf.set_font('Helvetica', 'B', 9)
    pdf.set_text_color(255, 255, 255)
    pdf.cell(6.4, 4.4, str(i), align='C')
    pdf.set_xy(pdf.l_margin + 9.5, y0)
    pdf.set_font('Helvetica', 'B', 10.5)
    pdf.set_text_color(*CHAR)
    pdf.multi_cell(CW - 9.5, 5, t, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.set_x(pdf.l_margin + 9.5)
    pdf.set_font('Helvetica', '', 9)
    pdf.set_text_color(*GRAY)
    pdf.multi_cell(CW - 9.5, 4.3, d, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.ln(2.6)

# ---- the "I don't want to talk" box (full width, below the QR panel)
y = max(pdf.get_y(), qy + QW + 22) + 2
pdf.set_y(y)
pdf.set_fill_color(*CREAM)
pdf.set_draw_color(*GOLD)
pdf.rect(pdf.l_margin, y, W, 24, style='DF')
pdf.set_fill_color(*GOLD)
pdf.rect(pdf.l_margin, y, 1.8, 24, style='F')
pdf.set_xy(pdf.l_margin + 6, y + 3.5)
pdf.set_font('Helvetica', 'B', 10)
pdf.set_text_color(*MAROON)
pdf.cell(W - 12, 5, 'You do not have to talk.', new_x=XPos.LMARGIN, new_y=YPos.NEXT)
pdf.set_x(pdf.l_margin + 6)
pdf.set_font('Helvetica', '', 9)
pdf.set_text_color(*CHAR)
pdf.multi_cell(W - 12, 4.3,
               'Every field is a normal box, dropdown, or counter, so you can tap through an entire match and never '
               'touch the microphone. Voice is a shortcut for people who want it. Both ways send the exact same row, '
               'and nobody can tell the difference afterwards.',
               new_x=XPos.LMARGIN, new_y=YPos.NEXT)
pdf.set_y(y + 24 + 5)

# ---- good to know / if something goes wrong, two columns
colw = (W - 8) / 2
top = pdf.get_y()


def col(x, title, items):
    pdf.set_xy(x, top)
    pdf.set_font('Helvetica', 'B', 8)
    pdf.set_text_color(*GOLD)
    pdf.cell(colw, 5, title.upper(), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.ln(0.5)
    for label, text in items:
        pdf.set_x(x)
        pdf.set_font('Helvetica', '', 9)
        pdf.set_text_color(*CHAR)
        pdf.multi_cell(colw, 4.3, '**' + label + '** ' + text, markdown=True,
                       new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        pdf.ln(1.4)
    return pdf.get_y()


y1 = col(pdf.l_margin, 'Good to know', [
    ('No signal?', 'Keep scouting. It saves everything on your phone and sends it the moment you are back online. Nothing is ever lost.'),
    ('One scouter, many matches.', 'There is no limit. Save and next, over and over, all event.'),
    ('You cannot break anything.', 'You can only send matches in. You have no access to the spreadsheet itself.'),
])
y2 = col(pdf.l_margin + colw + 8, 'If something goes wrong', [
    ('Mic does nothing?', 'On iPhone open the link in Safari, not Chrome. On a computer use Chrome, Edge, or Safari. Firefox has no voice.'),
    ('Browser blocked it?', 'Tap the lock icon next to the web address, allow the microphone, then reload.'),
    ('Still stuck?', 'Type into the big box instead and carry on. Every feature works the same.'),
])

pdf.set_y(max(y1, y2) + 3)
pdf.set_draw_color(*LINE)
pdf.line(pdf.l_margin, pdf.get_y(), pdf.w - pdf.r_margin, pdf.get_y())
pdf.ln(2)
pdf.set_font('Helvetica', '', 8)
pdf.set_text_color(*GRAY)
pdf.cell(0, 5, 'Bobcat Scout  -  Scout by voice. Win by data.', align='L')
pdf.cell(0, 5, APP, align='R')

pdf.output(OUT)
print('saved', OUT)
