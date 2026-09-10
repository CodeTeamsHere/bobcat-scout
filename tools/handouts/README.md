# Handout and deck builders

Scripts that generate the printed material for pitching Bobcat Scout to the team.
They are here so anyone can regenerate the handouts after the wording changes,
without needing the original design files.

| Script | Produces | Needs |
|---|---|---|
| `build_pilot_proposal.py` | `Bobcat Scout - Pilot Proposal.pdf` — the 3-page leave-behind for a lead meeting, including the objection-and-answer section | `pip install fpdf2` |
| `build_quick_start.py` | `Bobcat Scout - Scouter Quick Start.pdf` — the one-page scouter handout with a QR to the live app | `pip install fpdf2 "qrcode[pil]"` |
| `build_pitch_deck_slides.py` | `Bobcat_Scout_pitch_deck_v2.pptx` — adds the three honest-pitch slides to the designed deck by cloning existing slides and rewriting their text | `pip install python-pptx`, plus `Bobcat_Scout_pitch_deck.pptx` as the input |

All three write into `~/Downloads` by default. Change the `OUT` constant at the top
of each script to send them somewhere else.

The wording in the PDFs is kept in sync with [`PILOT-PROPOSAL.md`](../../PILOT-PROPOSAL.md)
by hand, so edit the markdown first and then mirror the change into the script.

## Notes for anyone editing these

- `fpdf2` writes text left to right from the current cursor. After a `multi_cell`,
  pass `new_x=XPos.LMARGIN, new_y=YPos.NEXT` or the cursor is left at the right
  margin and the next call fails with "Not enough horizontal space".
- In `build_pitch_deck_slides.py`, runs must sit **before** `<a:endParaRPr>` inside
  a paragraph. Appending a run after it produces a file that opens fine but shows
  no text at all in PowerPoint, which is why the text is built through
  python-pptx's own `add_run()` rather than by hand.
- Cloning a slide with `add_slide()` gives you the *layout's* background, not the
  source slide's. `clone_slide()` copies the `<p:bg>` element across explicitly.
