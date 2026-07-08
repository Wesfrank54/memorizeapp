"""
Build ODS Galley Procedures deck from the ODS Knowledge Book (PDF 26070, pp. 20–22).

Card design targets Learn mode:
  - Short command/response pairs (MCQ → blank → typed ladder)
  - Phase tags become concept units (entering, lines, seating, exit, …)
  - Cloze cards for verbatim sound-offs and the seating mantra
"""
from __future__ import annotations

import csv
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DECK = "ODS Galley Procedures"
PDF_REF = "26070 ODS Knowledge Book.pdf"

cards: list[dict[str, str]] = []


def add(front: str, back: str, tag: str, typ: str = "basic", text: str = "") -> None:
    cards.append({
        "type": typ,
        "deck": DECK,
        "front": front,
        "back": back,
        "text": text,
        "image": "",
        "tags": tag,
    })


def add_cloze(text: str, tag: str) -> None:
    cards.append({
        "type": "cloze",
        "deck": DECK,
        "front": "",
        "back": "",
        "text": text,
        "image": "",
        "tags": tag,
    })


# --- Overview (short intro cards first — better MCQ distractors in Learn) ---
add(
    "Galley procedures motto (three words required at all times)?",
    "Speed, volume, and intensity",
    "galley-overview",
)
add(
    "Galley motto — which is NOT part of it?",
    "Silence, patience, and caution",
    "galley-overview",
)
add(
    "Who may modify basic galley procedures?",
    "The Class Team",
    "galley-overview",
)
add(
    "Why may the Class Team modify galley procedures?",
    "Schedule or training requirements",
    "galley-overview",
)

# --- Approach / halt ---
add(
    "Before entering, the company halts at which building?",
    "Ney Hall",
    "galley-approach",
)
add(
    "What is \"The Chute\"?",
    "The blue awning at the front of Ney Hall",
    "galley-approach",
)
add(
    "Where exactly does the company halt at Ney Hall?",
    "The step leading to the double door entrance",
    "galley-approach",
)
add(
    "Chow time for each class/company is found where?",
    "Plan of the day (POD)",
    "galley-approach",
)
add(
    "Where does the Drill Officer march the company before entering the galley?",
    "Front of Ney Hall under the blue awning (\"The Chute\"), halted at the step to the double doors",
    "galley-approach",
)

# --- Drill Officer setup ---
add(
    "Where does the Drill Officer post before commencing galley procedures?",
    "Port side of the formation, abreast of the first rank, then right face to the company",
    "galley-drill-officer",
)
add(
    "Drill Officer: \"Guide, post the guidon.\" — Guide's response?",
    "Aye-aye, Sir/Ma'am",
    "galley-drill-officer",
)
add(
    "After posting the guidon, where does the Guide fall in?",
    "Rear of the company formation",
    "galley-drill-officer",
)
add(
    "Drill Officer: \"Mess Treasurer, fall out.\" — Mess Treasurer's response?",
    "Aye-aye, Sir/Ma'am",
    "galley-drill-officer",
)
add(
    "When the Mess Treasurer falls out, what two things do they do?",
    "Report company arrival to the mess attendant and request seating",
    "galley-mess-treasurer",
)
add(
    "Glow belts during entering: stow in which pocket?",
    "Starboard pocket",
    "galley-drill-officer",
)
add(
    "\"Prepare to crush starboard\" — when do students say \"Pain\"?",
    "When both heels come together after the starboard side-step",
    "galley-drill-officer",
)
add_cloze(
    "Drill Officer: \"Ready\" → company: \"{{c1::Discipline}}\"; "
    "Drill Officer: \"Move\" → company: \"{{c2::Pain}}\" (crush starboard).",
    "galley-drill-officer",
)
add(
    "Drill Officer: \"Mess Treasurer, Report.\" — what does the Mess Treasurer report about lines?",
    "The company will utilize all lines (1, 2, 3, 4)",
    "galley-mess-treasurer",
)
add(
    "Mess Treasurer report: seating location is directed by whom?",
    "Galley Attendant (goat locker / active scullery / inactive scullery / shark tank)",
    "galley-mess-treasurer",
)
add(
    "Drill Officer: \"First four to the door\" — what do the first four do?",
    "Open the inner and outer doors to the galley",
    "galley-entry",
)

# --- Column of files / entering ---
add(
    "Drill Officer: \"Column of files from the left, last Sailor sound off last Sailor.\" "
    "— column leader's response?",
    "Forward",
    "galley-entry",
)
add(
    "Other squad leaders during column of files from the left?",
    "Stand Fast (heads snapped left)",
    "galley-entry",
)
add_cloze(
    "Last Sailor in the column sounds off: \"{{c1::Last Sailor}}\"",
    "galley-entry",
)
add(
    "When entering the galley, where are hand sanitizer dispensers?",
    "On the right inside the doors",
    "galley-entry",
)
add(
    "When are covers removed during entry?",
    "While filing out, before sanitizing hands",
    "galley-entry",
)

# --- Chow lines ---
add(
    "In the chow line: talking or looking around?",
    "No talking and no looking around",
    "galley-lines",
)
add(
    "Tray position while moving through chow lines?",
    "Elbows tucked, arms parallel to the deck",
    "galley-lines",
)
add(
    "Student forgot knowledge book/sheet at chow — what do they study with?",
    "A table condiment held straight out in the right hand",
    "galley-lines",
)
add(
    "Outer garments (coats/jackets) at the table — when removed?",
    "Before arranging trays; placed on the back of the chair",
    "galley-lines",
)
add(
    "Coffee/salad bar (if authorized): retrieve when?",
    "After the 15-minute warning (or at 15-minute warning per class team)",
    "galley-lines",
)

# --- Seating / section leader ---
add(
    "Section Leader seat location at the table?",
    "Forward-most, inboard to the active scullery",
    "galley-seating",
)
add(
    "Section Leader: \"Put it away table one\" — table response?",
    "Aye-aye Sir/Ma'am",
    "galley-seating",
)
add(
    "At preparatory command \"Take\" (before Seats), where is the right hand?",
    "On the back of the chair (overhand grip), in unison",
    "galley-seating",
)
add_cloze(
    "At execution \"Seats,\" the table recites: "
    "\"{{c1::TO LEAD IS TO SERVE}} / {{c2::ALWAYS WATCHED ALWAYS JUDGED}} / "
    "{{c3::YOUR COMPANY MANTRA}}\"",
    "galley-seating",
)
add(
    "Seated at attention: heel angle?",
    "45 degrees",
    "galley-seating",
)
add(
    "Seated at attention: hand position?",
    "Knife hands flat on each lap, not beyond the knees",
    "galley-seating",
)
add(
    "From which side do students move into seats?",
    "Port side",
    "galley-seating",
)

# --- Meal / warnings ---
add(
    "15-minute warning: what may students begin?",
    "Eating (thousand-yard stare; elbows off table; chew with mouth closed)",
    "galley-meal",
)
add(
    "10- or 5-minute warnings: company reply if no food in mouth?",
    "Aye-aye Sir/Ma'am",
    "galley-meal",
)
add(
    "Done eating early before warnings end — position?",
    "POA, thousand-yard stare, feet 45°, knife hands on upper thighs",
    "galley-meal",
)
add(
    "Immediate warning: does the table respond verbally?",
    "No — pause; no one gets up to retrieve anything",
    "galley-meal",
)
add(
    "After immediate warning, cups go where?",
    "On the tray (all eating/drinking/chewing finished)",
    "galley-meal",
)

# --- Exit ---
add(
    "\"Take … feet\" — list three actions before facing inboard.",
    "Stand, push chairs in, don outer wear and glow belts, pick up trays, wipe table area",
    "galley-exit",
)
add(
    "Trash vs trays on exit: where does each go?",
    "Trash (non-food) in trash cans; trays in the scullery",
    "galley-exit",
)
add(
    "Exit route after scullery?",
    "Up the center passageway as directed by the Class Chief",
    "galley-exit",
)
add(
    "Column of files to exit: which side is chosen?",
    "Left or right — whichever is closest to the active scullery",
    "galley-exit",
)

# --- Corrections ---
add(
    "Company fails commands (not in unison / no motivation) — who may call \"As you were\"?",
    "Any student (especially the Section Leader)",
    "galley-corrections",
)
add(
    "Tray arrangement reference?",
    "Tray diagrams on page F-4 of the knowledge book",
    "galley-corrections",
)

# --- Sequence cards (interleaved review) ---
add(
    "Galley entering: after Mess Treasurer returns and centers, next Drill Officer command?",
    "Mess Treasurer, Report",
    "galley-sequence",
)
add(
    "Galley entering: after crush starboard, next step involving Mess Treasurer?",
    "Mess Treasurer, Report (after MT centers on company)",
    "galley-sequence",
)
add(
    "After \"Put it away,\" next Section Leader command sequence?",
    "Take … (pause) … Seats",
    "galley-sequence",
)
add(
    "After immediate warning, next Section Leader command?",
    "Take … (pause) … feet",
    "galley-sequence",
)

FIELDNAMES = ["type", "deck", "front", "back", "text", "image", "tags"]


def write_csv(path: Path) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=FIELDNAMES)
        w.writeheader()
        w.writerows(cards)


out = ROOT / "ODS_Galley_Procedures_deck.csv"
write_csv(out)

public_decks = ROOT / "public" / "decks"
public_decks.mkdir(parents=True, exist_ok=True)
shutil.copy2(out, public_decks / "ODS_Galley_Procedures_deck.csv")

print(f"Source: {PDF_REF}")
print(f"Wrote {len(cards)} cards → {out}")
print(f"Copied → {public_decks / 'ODS_Galley_Procedures_deck.csv'}")
by_tag: dict[str, int] = {}
for c in cards:
    by_tag[c["tags"]] = by_tag.get(c["tags"], 0) + 1
for tag, n in sorted(by_tag.items()):
    print(f"  {tag}: {n}")