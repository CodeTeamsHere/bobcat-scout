"""Turn the team's QRScout config into Bobcat Scout's config.json.

    python tools/from-qrscout.py reference/QRScout_config.json

QRScout is the form the team already uses, so it is the source of truth for
field names, codes and choices. Converting from it — rather than retyping the
form — means the two stay interchangeable: the same codes, the same option
keys, so a Bobcat Scout row drops straight into the existing pipeline.

What this script CANNOT know is the scoring: how many points a fuel is worth,
what a climb is worth, which booleans mean the robot broke. Those live in
SCORING below and are merged on top. Update SCORING when the game changes,
then re-run this.
"""
import io
import json
import sys
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

# --- the four codes the rest of the app depends on -------------------------
# The Sheet de-duplicates on them and the analytics group by them, so they are
# kept even though QRScout names two of them differently.
IDENTITY = [
    {
        "title": "Abbreviated Scouter Name",
        "type": "text", "code": "scoutName", "required": True, "preserve": True,
        "placeholder": "Your name",
        "help": "QRScout calls this 'scouter'. Kept as scoutName because every row is stamped with it."
    },
    {
        "title": "Event Key",
        "type": "text", "code": "eventKey", "required": True, "preserve": True,
        "placeholder": "2026ctwat",
        "help": "Set once per competition. The Sheet uses it to keep events apart."
    },
]
MATCH_TYPE = {
    "title": "Match Type",
    "type": "select", "code": "matchType", "default": "qm",
    "options": [
        {"k": "qm", "v": "Qualification"},
        {"k": "pm", "v": "Practice"},
        {"k": "sf", "v": "Playoff"}
    ]
}
ALLIANCE = {
    "title": "Alliance",
    "type": "select", "code": "alliance", "hidden": True, "preserve": True, "default": "",
    "help": "Derived from the starting position. Never typed.",
    "options": [
        {"k": "", "v": "—"},
        {"k": "red", "v": "Red"},
        {"k": "blue", "v": "Blue"}
    ]
}

# QRScout code -> Bobcat Scout code, where they must differ.
RENAME = {
    "scouter": "scoutName",
    "teamAndRobot": "teamNumber",
}

# --- REBUILT 2026 scoring, layered on top of the converted form ------------
# Keys are Bobcat Scout field codes. CHECK THESE AGAINST THE GAME MANUAL.
SCORING = {
    "autoFuelScored":   {"points": 1},
    "teleopFuelScored": {"points": 1},
    # QRScout's auto climb has no level, only whether it worked, so this is the
    # single auto-climb value rather than a per-level table.
    "autoClimbed":      {"optionPoints": {"Success": 15}},
    "climbed":          {"optionPoints": {"L1": 10, "L2": 20, "L3": 30}},
    # Booleans that mean the robot stopped contributing. These drive the
    # reliability score, not points.
    "noShow":           {"fail": True},
    "mechIssue":        {"fail": True},
    "died":             {"fail": True},
    "tipped":           {"fail": True},
}

# Which converted columns the ANALYZE tables summarise.
DISPLAY = {
    "autoCountCode": "autoFuelScored",
    "teleCountCode": "teleopFuelScored",
    "defenseCode": "defenceEffe",
    "climbCode": "climbed",
    "climbLevels": ["L1", "L2", "L3"]
}

# QRScout points at imgur; we keep a copy in the repo so it works offline.
# Re-download with: curl -L -o assets/field-layout.jpg <the imgur url>
LOCAL_IMAGES = {
    "fieldLayout": "assets/field-layout.jpg",
}

TYPE_MAP = {
    "text": "text",
    "number": "number",
    "select": "select",
    "boolean": "boolean",
    "multi-select": "multiselect",
    "multi-counter": "counter",
    "range": "range",
    "image": "image",
    "TBA-match-number": "number",
    "TBA-team-and-robot": "number",
}


def convert_field(f):
    code = RENAME.get(f.get("code"), f.get("code"))
    qtype = f.get("type")
    ftype = TYPE_MAP.get(qtype)
    if ftype is None:
        print('  ! skipping "%s" — unknown QRScout type %r' % (f.get("title"), qtype))
        return None

    # A long free-text box is a textarea, a short one is a single line.
    if ftype == "text" and (f.get("max") or 0) > 200:
        ftype = "textarea"

    out = {"title": f.get("title", code), "type": ftype, "code": code}
    if f.get("required"):
        out["required"] = True
    if f.get("description"):
        out["help"] = f["description"]
    if f.get("formResetBehavior") == "preserve":
        out["preserve"] = True

    if ftype in ("select", "multiselect"):
        choices = f.get("choices") or {}
        opts = [{"k": k, "v": v} for k, v in choices.items()]
        if ftype == "select":
            # a blank first entry so "not answered yet" is visible
            if not any(o["k"] == "" for o in opts):
                opts.insert(0, {"k": "", "v": "—"})
            out["default"] = f.get("defaultValue") or ""
        out["options"] = opts
    elif ftype == "range":
        out["default"] = f.get("defaultValue") or 0
        out["min"] = f.get("min", 0)
        out["max"] = f.get("max", 5)
        out["step"] = f.get("step", 1)
    elif ftype == "counter":
        out["default"] = f.get("defaultValue") or 0
        out["min"] = 0
        out["max"] = 300
        out["steps"] = [1, 5, 10]
    elif ftype == "number":
        out["default"] = f.get("defaultValue") or (177 if code == "teamNumber" else 1)
        out["min"] = 1
        out["max"] = 99999 if code == "teamNumber" else 200
    elif ftype == "boolean":
        out["default"] = bool(f.get("defaultValue"))
    elif ftype == "image":
        # Serve it from the repo, not from imgur. The app has to work with no
        # signal at a venue, and that is exactly when a scouter needs the
        # field diagram to work out which of the six slots they are watching.
        out["src"] = LOCAL_IMAGES.get(code, f.get("defaultValue", ""))
        out["remoteSrc"] = f.get("defaultValue", "")
        out["alt"] = f.get("alt", "")
        out["height"] = f.get("height", 300)
    else:
        out["default"] = f.get("defaultValue") or ""
        if f.get("max"):
            out["maxLength"] = f["max"]

    if code in SCORING:
        out.update(SCORING[code])
    return out


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'reference', 'QRScout_config.json')
    q = json.load(io.open(src, encoding='utf-8'))
    print('Reading %s' % src)

    sections = []
    for qs in q.get("sections", []):
        fields = []
        # The identity block goes at the top of Prematch, where scouters expect it.
        if qs.get("name", "").lower() == "prematch":
            fields.extend(IDENTITY)
        for qf in qs.get("fields", []):
            cf = convert_field(qf)
            if cf:
                # QRScout's "scouter" renames onto the identity block we already
                # added, so don't emit the column twice.
                if any(existing["code"] == cf["code"] for existing in fields):
                    continue
                fields.append(cf)
                # Match Type has no QRScout equivalent but the Sheet needs it.
                if cf["code"] == "matchNumber":
                    fields.append(dict(MATCH_TYPE))
                # Alliance is derived from the starting slot.
                if cf["code"] == "startPos":
                    fields.append(dict(ALLIANCE))
        sections.append({"name": qs.get("name", "Section"), "fields": fields})

    cfg = {
        "title": q.get("page_title", "Scouting") + " " + str(SCORING.get("_year", 2026)),
        "delimiter": q.get("delimiter", "\t"),
        "game": {
            "name": q.get("page_title", "Unknown"),
            "year": 2026,
            "note": "Generated from reference/QRScout_config.json by tools/from-qrscout.py. "
                    "Edit the QRScout config and re-run rather than hand-editing this file. "
                    "Scoring values live in SCORING inside that script.",
            "display": DISPLAY
        },
        "sections": sections
    }
    cfg["title"] = "REBUILT 2026"

    out = os.path.join(ROOT, 'config.json')
    io.open(out, 'w', encoding='utf-8', newline='').write(
        json.dumps(cfg, indent=2, ensure_ascii=False) + '\n')

    n = sum(len(s["fields"]) for s in sections)
    print('Wrote %s — %d sections, %d fields' % (out, len(sections), n))
    codes = [f["code"] for s in sections for f in s["fields"]]
    missing = [c for c in SCORING if c not in codes]
    if missing:
        print('  ! SCORING refers to codes that are not in the form: %s' % ', '.join(missing))
    for key in ('autoCountCode', 'teleCountCode', 'defenseCode', 'climbCode'):
        if DISPLAY[key] not in codes:
            print('  ! DISPLAY.%s = %r is not a field code' % (key, DISPLAY[key]))
    print('\nNow run:  node tools/test-parser.js && node tools/test-analytics.js')


if __name__ == '__main__':
    main()
