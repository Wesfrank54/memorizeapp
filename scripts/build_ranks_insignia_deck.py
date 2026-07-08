"""
Build ODS ranks/insignia decks from the ODS Knowledge Book (PDF 26070).

Outputs:
  - ODS_Ranks_Insignia_deck.csv  — full text deck (all rank/collar/shoulder/sleeve cards)
  - ODS_Ranks_Demo_deck.csv      — PDF demo: full text deck + image→rank MCQ cards
  - public/decks/ODS_Ranks_Demo_deck.csv — copy for in-app fetch (Image Testing beta)
"""
from __future__ import annotations

import csv
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DECK = "ODS Ranks & Insignia"
DEMO_DECK = "ODS Ranks Demo (PDF)"
PDF_REF = "26070 ODS Knowledge Book.pdf"

cards: list[dict[str, str]] = []
image_cards: list[dict[str, str]] = []

# Navy officer collar device key → SVG slug (public/insignia/navy-officer-collar/)
COLLAR_IMAGE_SLUGS: dict[str, str] = {
    "W-2 CWO2": "w2-cwo2",
    "W-3 CWO3": "w3-cwo3",
    "W-4 CWO4": "w4-cwo4",
    "W-5 CWO5": "w5-cwo5",
    "O-1 ENS": "o1-ens",
    "O-2 LTJG": "o2-ltjg",
    "O-3 LT": "o3-lt",
    "O-4 LCDR": "o4-lcdr",
    "O-5 CDR": "o5-cdr",
    "O-6 CAPT": "o6-capt",
    "O-7 RDML": "o7-rdml",
    "O-8 RADM": "o8-radm",
    "O-9 VADM": "o9-vadm",
    "O-10 ADM": "o10-adm",
    "O-11 FADM": "o11-fadm",
}

# Collar key → full rank title (for image→rank cards)
COLLAR_TO_RANK: dict[str, str] = {
    "W-2 CWO2": "Chief Warrant Officer Two (CWO2)",
    "W-3 CWO3": "Chief Warrant Officer Three (CWO3)",
    "W-4 CWO4": "Chief Warrant Officer Four (CWO4)",
    "W-5 CWO5": "Chief Warrant Officer Five (CWO5)",
    "O-1 ENS": "Ensign (ENS)",
    "O-2 LTJG": "Lieutenant Junior Grade (LTJG)",
    "O-3 LT": "Lieutenant (LT)",
    "O-4 LCDR": "Lieutenant Commander (LCDR)",
    "O-5 CDR": "Commander (CDR)",
    "O-6 CAPT": "Captain (CAPT)",
    "O-7 RDML": "Rear Admiral Lower Half (RDML)",
    "O-8 RADM": "Rear Admiral (RADM)",
    "O-9 VADM": "Vice Admiral (VADM)",
    "O-10 ADM": "Admiral (ADM)",
    "O-11 FADM": "Fleet Admiral (FADM)",
}


def add(front: str, back: str, tag: str, typ: str = "basic", image: str = "") -> None:
    cards.append({
        "type": typ,
        "deck": DECK,
        "front": front,
        "back": back,
        "text": "",
        "image": image,
        "tags": tag,
    })


def add_image_rank(collar_key: str) -> None:
    slug = COLLAR_IMAGE_SLUGS.get(collar_key)
    rank = COLLAR_TO_RANK.get(collar_key)
    if not slug or not rank:
        return
    image_cards.append({
        "type": "basic",
        "deck": DEMO_DECK,
        "front": "What rank wears this collar device?",
        "back": rank,
        "text": "",
        "image": f"insignia/navy-officer-collar/{slug}.svg",
        "tags": "navy-officer-rank,image-beta,pdf-demo",
    })


# --- Navy officer (PDF pp. 9–11) ---
navy_officer_ranks = [
    ("W-2", "Chief Warrant Officer Two (CWO2)"),
    ("W-3", "Chief Warrant Officer Three (CWO3)"),
    ("W-4", "Chief Warrant Officer Four (CWO4)"),
    ("W-5", "Chief Warrant Officer Five (CWO5)"),
    ("O-1", "Ensign (ENS)"),
    ("O-2", "Lieutenant Junior Grade (LTJG)"),
    ("O-3", "Lieutenant (LT)"),
    ("O-4", "Lieutenant Commander (LCDR)"),
    ("O-5", "Commander (CDR)"),
    ("O-6", "Captain (CAPT)"),
    ("O-7", "Rear Admiral Lower Half (RDML)"),
    ("O-8", "Rear Admiral (RADM)"),
    ("O-9", "Vice Admiral (VADM)"),
    ("O-10", "Admiral (ADM)"),
    ("O-11", "Fleet Admiral (FADM)"),
]
for grade, name in navy_officer_ranks:
    add(f"Navy officer rank — {grade}?", name, "navy-officer-rank")

navy_officer_collar = [
    ("W-2 CWO2", "Gold bar with three blue breaks"),
    ("W-3 CWO3", "Silver bar with two blue breaks"),
    ("W-4 CWO4", "Silver bar with three blue breaks"),
    ("W-5 CWO5", "Silver bar with one 1/8-inch horizontal blue line"),
    ("O-1 ENS", "One gold bar"),
    ("O-2 LTJG", "One silver bar"),
    ("O-3 LT", "Two silver bars"),
    ("O-4 LCDR", "Gold oak leaf"),
    ("O-5 CDR", "Silver oak leaf"),
    ("O-6 CAPT", "Silver eagle"),
    ("O-7 RDML", "One silver five-pointed star"),
    ("O-8 RADM", "Two silver five-pointed stars"),
    ("O-9 VADM", "Three silver five-pointed stars"),
    ("O-10 ADM", "Four silver five-pointed stars"),
    ("O-11 FADM", "Five silver five-pointed stars"),
]
for rank, device in navy_officer_collar:
    add(f"Navy officer collar device — {rank}?", device, "navy-officer-collar")
    add_image_rank(rank)

navy_officer_shoulder = [
    ("W-2 CWO2", "One gold 1/2-inch stripe with three blue breaks outboard a specialty insignia"),
    ("W-3 CWO3", "One gold 1/2-inch stripe with two blue breaks outboard a specialty insignia"),
    ("W-4 CWO4", "One gold 1/2-inch stripe with one blue break outboard a specialty insignia"),
    ("W-5 CWO5", "Two thin gold stripes with one blue break outboard a specialty insignia"),
    ("O-1 ENS", "One gold 1/2-inch stripe outboard a gold five-pointed star"),
    ("O-2 LTJG", "One gold 1/2-inch stripe outboard one 1/4-inch gold stripe outboard a gold five-pointed star"),
    ("O-3 LT", "Two gold 1/2-inch stripes outboard a gold five-pointed star"),
    ("O-4 LCDR", "One gold 1/2-inch stripe outboard one gold 1/4-inch stripe outboard one gold 1/2-inch stripe outboard a gold five-pointed star"),
    ("O-5 CDR", "Three gold 1/2-inch stripes outboard a gold five-pointed star"),
    ("O-6 CAPT", "Four gold 1/2-inch stripes outboard a gold five-pointed star"),
    ("O-7 RDML", "Gold shoulder boards with one silver five-pointed star outboard a silver fouled anchor"),
    ("O-8 RADM", "Gold shoulder boards with two silver five-pointed stars outboard a silver fouled anchor"),
    ("O-9 VADM", "Gold shoulder boards with three silver five-pointed stars outboard a silver fouled anchor"),
    ("O-10 ADM", "Gold shoulder boards with four silver five-pointed stars outboard a silver fouled anchor"),
    ("O-11 FADM", "Gold shoulder boards with five silver five-pointed stars outboard a silver fouled anchor"),
]
for rank, board in navy_officer_shoulder:
    add(f"Navy officer shoulder board — {rank}?", board, "navy-officer-shoulder")

navy_officer_sleeve = [
    ("W-2 CWO2", "One gold 1/2-inch stripe with three blue breaks below a specialty insignia"),
    ("W-3 CWO3", "One gold 1/2-inch stripe with two blue breaks below a specialty insignia"),
    ("W-4 CWO4", "One gold 1/2-inch stripe with one blue break below a specialty insignia"),
    ("W-5 CWO5", "Two thin gold stripes with one blue break below a specialty insignia"),
    ("O-1 ENS", "One gold 1/2-inch stripe below a gold five-pointed star"),
    ("O-2 LTJG", "One gold 1/2-inch stripe below one 1/4-inch stripe below a gold five-pointed star"),
    ("O-3 LT", "Two gold 1/2-inch stripes below a gold five-pointed star"),
    ("O-4 LCDR", "One gold 1/2-inch stripe below one gold 1/4-inch stripe below one gold 1/2-inch stripe below a gold five-pointed star"),
    ("O-5 CDR", "Three gold 1/2-inch stripes below a gold five-pointed star"),
    ("O-6 CAPT", "Four gold 1/2-inch stripes below a gold five-pointed star"),
    ("O-7 RDML", "One gold 2-inch stripe below a gold five-pointed star"),
    ("O-8 RADM", "One gold 2-inch stripe below one gold 1/2-inch stripe below a gold five-pointed star"),
    ("O-9 VADM", "One gold 2-inch stripe below two gold 1/2-inch stripes below a gold five-pointed star"),
    ("O-10 ADM", "One gold 2-inch stripe below three gold 1/2-inch stripes below a gold five-pointed star"),
    ("O-11 FADM", "One gold 2-inch stripe below four gold 1/2-inch stripes below a gold five-pointed star"),
]
for rank, sleeve in navy_officer_sleeve:
    add(f"Navy officer sleeve insignia — {rank}?", sleeve, "navy-officer-sleeve")

navy_enlisted_ranks = [
    ("E-1", "Seaman Recruit (SR)"),
    ("E-2", "Seaman Apprentice (SA)"),
    ("E-3", "Seaman (SN)"),
    ("E-4", "Petty Officer Third Class (PO3)"),
    ("E-5", "Petty Officer Second Class (PO2)"),
    ("E-6", "Petty Officer First Class (PO1)"),
    ("E-7", "Chief Petty Officer (CPO)"),
    ("E-8", "Senior Chief Petty Officer (SCPO)"),
    ("E-9", "Master Chief Petty Officer (MCPO)"),
    ("E-9 (top)", "Master Chief Petty Officer of the Navy (MCPON)"),
]
for grade, name in navy_enlisted_ranks:
    add(f"Navy enlisted rank — {grade}?", name, "navy-enlisted-rank")

navy_enlisted_collar = [
    ("E-1 SR", "None"),
    ("E-2 SA", "Two diagonal stripes"),
    ("E-3 SN", "Three diagonal stripes"),
    ("E-4 PO3", "One eagle above one chevron"),
    ("E-5 PO2", "One eagle above two chevrons"),
    ("E-6 PO1", "One eagle above three chevrons"),
    ("E-7 CPO", "One eagle above one rocker above three chevrons"),
    ("E-8 SCPO", "One silver star above one eagle above one rocker above three chevrons"),
    ("E-9 MCPO", "Two silver stars above one eagle above one rocker above three chevrons"),
    ("E-9 MCPON", "Three gold stars above one eagle above one rocker above three chevrons"),
]
for rank, collar in navy_enlisted_collar:
    add(f"Navy enlisted collar device — {rank}?", collar, "navy-enlisted-collar")

navy_enlisted_sleeve = [
    ("E-1 SR", "None"),
    ("E-2 SA", "Two diagonal bars"),
    ("E-3 SN", "Three diagonal bars"),
    ("E-4 PO3", "One eagle above one chevron"),
    ("E-5 PO2", "One eagle above two chevrons"),
    ("E-6 PO1", "One eagle over three chevrons"),
    ("E-7 CPO", "Gold fouled anchor with silver USN centered across the anchor"),
    ("E-8 SCPO", "Gold fouled anchor with silver USN centered across the anchor below one silver star"),
    ("E-9 MCPO", "Gold fouled anchor with silver USN centered across the anchor below two silver stars"),
    ("E-9 MCPON", "Gold fouled anchor with silver USN centered across the anchor below three silver stars with a gold star specialty mark"),
]
for rank, sleeve in navy_enlisted_sleeve:
    add(f"Navy enlisted sleeve insignia — {rank}?", sleeve, "navy-enlisted-sleeve")

marine_officer_ranks = [
    ("W-1", "Warrant Officer (WO)"),
    ("W-2", "Chief Warrant Officer Two (CWO2)"),
    ("W-3", "Chief Warrant Officer Three (CWO3)"),
    ("W-4", "Chief Warrant Officer Four (CWO4)"),
    ("W-5", "Chief Warrant Officer Five (CWO5)"),
    ("O-1", "Second Lieutenant (2ndLt)"),
    ("O-2", "First Lieutenant (1stLt)"),
    ("O-3", "Captain (Capt)"),
    ("O-4", "Major (Maj)"),
    ("O-5", "Lieutenant Colonel (LtCol)"),
    ("O-6", "Colonel (Col)"),
    ("O-7", "Brigadier General (BGen)"),
    ("O-8", "Major General (MajGen)"),
    ("O-9", "Lieutenant General (LtGen)"),
    ("O-10", "General (Gen)"),
]
for grade, name in marine_officer_ranks:
    add(f"Marine officer rank — {grade}?", name, "marine-officer-rank")

marine_officer_collar = [
    ("W-1 WO", "Single bar device with a red background and one gold break"),
    ("W-2 CWO2", "Single bar device with a red background and two gold breaks"),
    ("W-3 CWO3", "Single bar device with a red background and one silver break"),
    ("W-4 CWO4", "Single bar device with a red background and two silver breaks"),
    ("W-5 CWO5", "Single silver bar device with a thin red break in the center"),
    ("O-1 2ndLt", "One gold bar"),
    ("O-2 1stLt", "One silver bar"),
    ("O-3 Capt", "Two silver bars"),
    ("O-4 Maj", "Gold oak leaf"),
    ("O-5 LtCol", "Silver oak leaf"),
    ("O-6 Col", "Silver eagle"),
    ("O-7 BGen", "One silver five-pointed star"),
    ("O-8 MajGen", "Two silver five-pointed stars"),
    ("O-9 LtGen", "Three silver five-pointed stars"),
    ("O-10 Gen", "Four silver five-pointed stars"),
]
for rank, collar in marine_officer_collar:
    add(f"Marine officer collar device — {rank}?", collar, "marine-officer-collar")

marine_enlisted_ranks = [
    ("E-1", "Private (Pvt)"),
    ("E-2", "Private First Class (PFC)"),
    ("E-3", "Lance Corporal (LCpl)"),
    ("E-4", "Corporal (Cpl)"),
    ("E-5", "Sergeant (Sgt)"),
    ("E-6", "Staff Sergeant (SSgt)"),
    ("E-7", "Gunnery Sergeant (GySgt)"),
    ("E-8", "Master Sergeant (MSgt)"),
    ("E-8 (alt)", "First Sergeant (1stSgt)"),
    ("E-9", "Master Gunnery Sergeant (MGySgt)"),
    ("E-9 (alt)", "Sergeant Major (SgtMaj)"),
    ("E-9 (top)", "Sergeant Major of the Marine Corps (SMMC)"),
]
for grade, name in marine_enlisted_ranks:
    add(f"Marine enlisted rank — {grade}?", name, "marine-enlisted-rank")

marine_enlisted_insignia = [
    ("E-1 Pvt", "None"),
    ("E-2 PFC", "One stripe"),
    ("E-3 LCpl", "One stripe over crossed rifles"),
    ("E-4 Cpl", "Two stripes over crossed rifles"),
    ("E-5 Sgt", "Three stripes over crossed rifles"),
    ("E-6 SSgt", "Three stripes over crossed rifles over one rocker"),
    ("E-7 GySgt", "Three stripes over crossed rifles over two rockers"),
    ("E-8 MSgt", "Three stripes over crossed rifles over three rockers"),
    ("E-8 1stSgt", "Three stripes over one diamond over three rockers"),
    ("E-9 MGySgt", "Three stripes over a bursting bomb over four rockers"),
    ("E-9 SgtMaj", "Three stripes over one star over four rockers"),
    ("E-9 SMMC", "Three stripes over the Marine Corps emblem centered between two five-pointed stars over four rockers"),
]
for rank, ins in marine_enlisted_insignia:
    add(f"Marine enlisted sleeve insignia / collar device — {rank}?", ins, "marine-enlisted-insignia")

add("Line and Restricted Line officer sleeve/shoulder device?", "A gold embroidered five-pointed star", "corps-devices")
add("Line and Restricted Line officer collar device?", "A gold embroidered five-pointed star (rank insignia worn on both collars)", "corps-devices")
add("Supply Corps officer sleeve/shoulder device?", "A gold embroidered sprig of three oak leaves and three acorns", "corps-devices")
add("Supply Corps officer collar device (left collar)?", "A gold metal sprig of three oak leaves and three acorns", "corps-devices")
add("Civil Engineer Corps officer sleeve/shoulder device?", "Two gold embroidered sprigs of two oak leaves and a silver acorn in each sprig", "corps-devices")
add("Civil Engineer Corps officer collar device (left collar)?", "A gold metal pin with two sprigs of two oak leaves and a silver acorn in each sprig", "corps-devices")
add("Staff Corps officers (Supply, CEC): where is the corps device worn on the collar?", "Left collar; rank insignia is worn on the right collar", "corps-devices")
add("Line and Restricted Line officers: where is rank insignia worn on the collar?", "Both collars", "corps-devices")
add("Navy E-7+ enlisted sleeve insignia: what anchor device is used?", "Gold fouled anchor with silver USN centered across the anchor (with stars below for E-8/E-9)", "navy-enlisted-sleeve")
add("Navy PO1 (E-6) vs CPO (E-7) collar device — what changes?", "CPO adds one rocker between the eagle and the three chevrons", "navy-enlisted-collar")
add("Navy SCPO vs MCPO collar device — star difference?", "SCPO: one silver star above eagle/rocker/chevrons. MCPO: two silver stars", "navy-enlisted-collar")
add("Marine MSgt vs 1stSgt (both E-8) — insignia difference?", "MSgt: crossed rifles. 1stSgt: one diamond (no crossed rifles)", "marine-enlisted-insignia")

FIELDNAMES = ["type", "deck", "front", "back", "text", "image", "tags"]


def write_csv(path: Path, rows: list[dict[str, str]]) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=FIELDNAMES)
        w.writeheader()
        w.writerows(rows)


# Full text deck (legacy import path)
text_out = ROOT / "ODS_Ranks_Insignia_deck.csv"
write_csv(text_out, cards)

# Demo deck: all text cards (re-tagged deck name) + image MCQ cards
demo_text = [{**row, "deck": DEMO_DECK} for row in cards]
demo_rows = demo_text + image_cards
demo_out = ROOT / "ODS_Ranks_Demo_deck.csv"
write_csv(demo_out, demo_rows)

public_decks = ROOT / "public" / "decks"
public_decks.mkdir(parents=True, exist_ok=True)
shutil.copy2(demo_out, public_decks / "ODS_Ranks_Demo_deck.csv")

print(f"Source: {PDF_REF}")
print(f"Wrote {len(cards)} text cards → {text_out}")
print(f"Wrote {len(demo_rows)} demo cards ({len(image_cards)} image MCQ) → {demo_out}")
print(f"Copied demo deck → {public_decks / 'ODS_Ranks_Demo_deck.csv'}")