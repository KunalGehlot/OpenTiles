"""Shared catalogue helpers: loading and validating provenance records. CC0 1.0."""

from __future__ import annotations

import json
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path

from eu_term import is_free, latest_free_death_year

ROOT = Path(__file__).resolve().parents[2]
CATALOGUE = ROOT / "catalogue"
PIECES = CATALOGUE / "pieces"

ALLOWED_LICENCES = {"CC0-1.0", "PDM-1.0", "public-domain", "CC-BY-3.0", "CC-BY-4.0"}
ATTRIBUTION_LICENCES = {"CC-BY-3.0", "CC-BY-4.0"}
SLUG = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")

REQUIRED = {
    "title": str,
    "composer": str,
    "composer_death_year": (int, type(None)),
    "traditional": bool,
    "transcriber": str,
    "arranger": (str, type(None)),
    "source_url": str,
    "source_licence": str,
    "edition_note": str,
    "eu_term_check": dict,
    "difficulty": int,
    "reviewed_by": (str, type(None)),
    "verified": bool,
    "score_file": str,
}


@dataclass
class Piece:
    slug: str
    path: Path
    record: dict


def load_pieces(pieces_dir: Path = PIECES) -> list[Piece]:
    out = []
    if not pieces_dir.exists():
        return out
    for d in sorted(p for p in pieces_dir.iterdir() if p.is_dir()):
        prov = d / "provenance.json"
        record = json.loads(prov.read_text(encoding="utf-8")) if prov.exists() else {}
        out.append(Piece(d.name, d, record))
    return out


def count_notes(score: Path) -> int:
    """Pitched notes in a partwise MusicXML file (raises on malformed XML)."""
    root = ET.parse(score).getroot()
    if root.tag != "score-partwise":
        raise ValueError(f"root element is <{root.tag}>, expected <score-partwise>")
    return sum(1 for n in root.iter("note") if n.find("pitch") is not None)


def validate_piece(piece: Piece, release_year: int) -> list[str]:
    """Problems with one piece; empty when it is fine."""
    errors: list[str] = []
    r = piece.record
    if not r:
        return ["missing provenance.json"]
    if not SLUG.match(piece.slug):
        errors.append("folder name must be lowercase words separated by hyphens")
    field_errors = []
    for key, types in REQUIRED.items():
        if key not in r:
            field_errors.append(f"missing field '{key}'")
        elif not isinstance(r[key], types) or (isinstance(r[key], bool) and types is int):
            field_errors.append(f"field '{key}' has the wrong type")
    if field_errors:
        return errors + field_errors

    if not r["title"].strip():
        errors.append("title is empty")
    if r["source_licence"] not in ALLOWED_LICENCES:
        errors.append(f"licence '{r['source_licence']}' is not one of {sorted(ALLOWED_LICENCES)}")
    if r["source_licence"] in ATTRIBUTION_LICENCES and not r.get("attribution"):
        errors.append("CC BY pieces need an 'attribution' line to show on the piece page")
    if not 1 <= r["difficulty"] <= 5:
        errors.append("difficulty must be 1 to 5")
    if not r["source_url"].startswith("https://"):
        errors.append("source_url must be an https:// link")

    # EU term: composer, and lyricist when the piece has lyrics.
    latest = latest_free_death_year(release_year)
    if not is_free(r["composer_death_year"], release_year, r["traditional"]):
        errors.append(
            f"composer must have died in {latest} or earlier for a {release_year} release "
            "(or the tune must be marked traditional)"
        )
    if r.get("lyricist"):
        if not is_free(r.get("lyricist_death_year"), release_year):
            errors.append(f"lyricist must have died in {latest} or earlier, or drop the lyrics")
    check = r["eu_term_check"]
    if check.get("result") != "pass" or not isinstance(check.get("date"), str):
        errors.append("eu_term_check must record result 'pass' and the date it was checked")

    if r["verified"] and not r["reviewed_by"]:
        errors.append("a verified piece needs reviewed_by (the reviewer's GitHub handle)")

    score = piece.path / r["score_file"]
    if not score.exists():
        errors.append(f"score file '{r['score_file']}' not found")
    else:
        try:
            if count_notes(score) == 0:
                errors.append("score has no notes")
        except (ET.ParseError, ValueError) as e:
            errors.append(f"score is not valid partwise MusicXML: {e}")
    return errors


def index_entry(piece: Piece) -> dict:
    r = piece.record
    entry = {
        "slug": piece.slug,
        "title": r["title"],
        "composer": r["composer"],
        "difficulty": r["difficulty"],
        "licence": r["source_licence"],
        "verified": r["verified"],
        "score": f"pieces/{piece.slug}/{r['score_file']}",
    }
    if r.get("attribution"):
        entry["attribution"] = r["attribution"]
    return entry
