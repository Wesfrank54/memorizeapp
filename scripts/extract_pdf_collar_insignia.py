"""
Extract Navy officer collar-device images from ODS Knowledge Book PDF (pages 9–11).

Crops the middle "Collar Device" column and saves PNGs to
public/insignia/navy-officer-collar/ for image MCQ cards.
"""
from __future__ import annotations

import argparse
from pathlib import Path

import fitz  # PyMuPDF

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PDF = Path.home() / "Downloads" / "26070 ODS Knowledge Book.pdf"
OUT_DIR = ROOT / "public" / "insignia" / "navy-officer-collar"

# Pages 9–11 in document order (1-based) → W-2 … O-11 collar devices top-to-bottom
PAGE_NUMBERS = (9, 10, 11)
SLUGS = (
    "w2-cwo2",
    "w3-cwo3",
    "w4-cwo4",
    "w5-cwo5",
    "o1-ens",
    "o2-ltjg",
    "o3-lt",
    "o4-lcdr",
    "o5-cdr",
    "o6-capt",
    "o7-rdml",
    "o8-radm",
    "o9-vadm",
    "o10-adm",
    "o11-fadm",
)

# Collar Device column: narrow insignia left of Shoulder Board (x ≈ 155–225)
COLLAR_X_MAX = 240.0
ZOOM = 4.0
PAD = 2.0


def collar_rects(page: fitz.Page) -> list[fitz.Rect]:
    rects: list[fitz.Rect] = []
    for img in page.get_images(full=True):
        xref = img[0]
        for rect in page.get_image_rects(xref):
            if rect.x0 < COLLAR_X_MAX:
                rects.append(rect)
    rects.sort(key=lambda r: (round(r.y0, 1), round(r.x0, 1)))
    return rects


def extract(pdf_path: Path, out_dir: Path) -> list[Path]:
    doc = fitz.open(pdf_path)
    out_dir.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    slug_idx = 0
    mat = fitz.Matrix(ZOOM, ZOOM)

    for page_no in PAGE_NUMBERS:
        page = doc[page_no - 1]
        rects = collar_rects(page)
        if len(rects) != 5:
            doc.close()
            raise RuntimeError(f"Page {page_no}: expected 5 collar images, found {len(rects)}")

        for rect in rects:
            slug = SLUGS[slug_idx]
            clip = fitz.Rect(
                rect.x0 - PAD,
                rect.y0 - PAD,
                rect.x1 + PAD,
                rect.y1 + PAD,
            ) & page.rect
            pix = page.get_pixmap(matrix=mat, clip=clip, alpha=False)
            dest = out_dir / f"{slug}.png"
            pix.save(dest)
            written.append(dest)
            slug_idx += 1

    doc.close()
    if slug_idx != len(SLUGS):
        raise RuntimeError(f"Expected {len(SLUGS)} images, wrote {slug_idx}")
    return written


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract collar-device PNGs from ODS Knowledge Book PDF")
    parser.add_argument("--pdf", type=Path, default=DEFAULT_PDF, help="Path to 26070 ODS Knowledge Book.pdf")
    parser.add_argument("--out", type=Path, default=OUT_DIR, help="Output directory for PNG files")
    args = parser.parse_args()

    if not args.pdf.is_file():
        raise SystemExit(f"PDF not found: {args.pdf}")

    paths = extract(args.pdf, args.out)
    print(f"Source: {args.pdf}")
    print(f"Wrote {len(paths)} collar-device PNGs → {args.out}")
    for p in paths:
        print(f"  {p.name}")


if __name__ == "__main__":
    main()