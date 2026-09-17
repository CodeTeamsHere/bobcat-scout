"""Build the invite link that carries the team's private values.

    python tools/make-invite-link.py

The app's public address, its client ID and the event code all live in
team-config.js and are safe to publish. The passcode and the Blue Alliance key
are NOT — this repository is public, and git history is permanent. They travel
in the link instead, which you send to your scouters privately.

This script only prints. It writes nothing, saves nothing, and sends nothing.
Paste the result into your team chat.
"""
import io
import os
import re
import sys
from urllib.parse import quote

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
APP = 'https://codeteamshere.github.io/bobcat-scout/'


def preset(key):
    """Read a value out of team-config.js so the link matches what is deployed."""
    try:
        src = io.open(os.path.join(ROOT, 'team-config.js'), encoding='utf-8').read()
        body = src[src.index('window.TEAM_CONFIG'):]
        m = re.search(key + r"\s*:\s*'([^']*)'", body)
        return m.group(1) if m else ''
    except Exception:
        return ''


def ask(label, note):
    print('\n' + label)
    print('  ' + note)
    return input('  > ').strip()


def main():
    print('=' * 68)
    print('Bobcat Scout — build the invite link')
    print('=' * 68)

    if not preset('sheetUrl'):
        print('\n! team-config.js has no sheetUrl yet. Do SETUP-ONCE.md first.')
        return 1
    if preset('passcode'):
        print('\n! team-config.js already has a passcode in it, which means it is')
        print('  published. Blank it and use this link instead, or accept that it')
        print('  is public. See SETUP-ONCE.md, "Read this before you publish".')

    passcode = ask('Team passcode',
                   'Exactly as it appears in the Sheet\'s Config tab. Leave blank to skip.')
    tba = ask('Blue Alliance read key',
              'From thebluealliance.com/account. Leave blank to skip (scouters then'
              '\n  type team numbers by hand).')

    parts = []
    if passcode:
        parts.append('key=' + quote(passcode, safe=''))
    if tba:
        parts.append('tba=' + quote(tba, safe=''))

    if not parts:
        print('\nNothing to carry — the plain address is enough:\n\n  ' + APP)
        return 0

    link = APP + '?' + '&'.join(parts)
    print('\n' + '-' * 68)
    print('Send this to your scouters:\n')
    print('  ' + link)
    print('\n' + '-' * 68)
    print('They open it once. The app stores the values on their phone and wipes')
    print('them out of the address bar, so the link is not left lying around in')
    print('their browser history in a readable form.')
    print('\nTreat this link like a password:')
    print('  - team group chat, yes')
    print('  - anywhere public, no')
    print('  - changed the passcode? send a new link, the old one stops working')
    return 0


if __name__ == '__main__':
    sys.exit(main())
