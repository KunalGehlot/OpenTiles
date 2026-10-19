"""Shared catalogue helpers: loading and validating provenance records. CC0 1.0."""

from __future__ import annotations

import datetime
import json
import re
import xml.etree.ElementTree as ET
import zipfile
from dataclasses import dataclass
from pathlib import Path

import editions
from eu_term import is_free, latest_free_death_year
from score_checks import check_score, load_score

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
OPTIONAL = {
    "lyricist": (str, type(None)),
    "lyricist_death_year": (int, type(None)),
    "attribution": str,
    "composer_wikidata": str,
    "lyricist_wikidata": str,
    "single_hand": str,
    "reviewed_on": str,
    "song": str,
    "variant": str,
    "print_source": str,
    "print_year": int,
}
PRINT_BEFORE = 1930
QID = re.compile(r"^Q[1-9][0-9]*$")
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


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


def _is_date(value: object) -> bool:
    if not isinstance(value, str) or not DATE.match(value):
        return False
    try:
        datetime.date.fromisoformat(value)
    except ValueError:
        return False
    return True


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
    for key, value in r.items():
        if key in REQUIRED:
            continue
        if key not in OPTIONAL:
            field_errors.append(f"unknown field '{key}' (see catalogue/schema/provenance.schema.json)")
        elif not isinstance(value, OPTIONAL[key]) or (isinstance(value, bool) and int in OPTIONAL[key]):
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

    if not _is_date(check.get("date")):
        errors.append("eu_term_check date must be a real date written YYYY-MM-DD")
    for key in ("composer_wikidata", "lyricist_wikidata"):
        if key in r and not QID.match(r[key]):
            errors.append(f"{key} must be a Wikidata item ID like Q7294")
    if ("song" in r) != ("variant" in r):
        errors.append("'song' and 'variant' go together: a piece that is one level of a song needs both")
    if "song" in r and not SLUG.match(r["song"]):
        errors.append("song must be lowercase words separated by hyphens")
    if "variant" in r and not r["variant"].strip():
        errors.append("variant is empty")
    if "single_hand" in r and r["single_hand"] not in ("right", "left"):
        errors.append("single_hand must be 'right' or 'left'")

    if r["verified"]:
        if not r["reviewed_by"]:
            errors.append("a verified piece needs reviewed_by (the reviewer's GitHub handle)")
        if not _is_date(r.get("reviewed_on")):
            errors.append("a verified piece needs reviewed_on, the review date as YYYY-MM-DD")
    elif r["reviewed_by"]:
        errors.append("reviewed_by is set but verified is false; finish the review or clear it")

    # Spec §9 step 3: only the transcriber's own work, never a copy of a protected edition.
    edition_errors, _ = editions.check_provenance(r)
    errors += edition_errors

    # A score typeset from an older print: the print must be old (nothing of a recent edition is free).
    year = r.get("print_year")
    if year is not None and year >= PRINT_BEFORE:
        errors.append(f"print_year {year} is not before {PRINT_BEFORE}: a recent print may be protected")
    if r.get("print_source") and not _print_is_dated(r):
        errors.append("print_source names a print with no year or century: say when it was printed")

    # Spec §9 step 4: the file must parse and make musical sense.
    score = piece.path / r["score_file"]
    if not score.exists():
        errors.append(f"score file '{r['score_file']}' not found")
    else:
        try:
            root = load_score(score)
        except (ET.ParseError, ValueError, KeyError, zipfile.BadZipFile) as e:
            errors.append(f"score is not valid partwise MusicXML: {e}")
        else:
            if not any(n.find("pitch") is not None for n in root.iter("note")):
                errors.append("score has no notes")
            else:
                errors += [f"score: {e}" for e in check_score(root, r.get("single_hand"))]
    return errors


def _print_is_dated(r: dict) -> bool:
    """True when print_year is set or the source names a year or an earlier century."""
    if r.get("print_year") is not None:
        return True
    return bool(re.search(r"\b1[5-9]\d\d|\b(?:17|18|19)th[ -]century", str(r.get("print_source", "")), re.I))


def review_notes(piece: Piece) -> list[str]:
    """Things a reviewer should look at that do not fail the check (REVIEWING.md)."""
    if not piece.record:
        return []
    _, notes = editions.check_provenance(piece.record)
    return notes


def index_entry(piece: Piece, composer_years: list[int] | None = None) -> dict:
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
    if r.get("song"):
        entry["song"] = r["song"]
        entry["variant"] = r["variant"]
    if composer_years:
        entry["composer_years"] = composer_years
    return entry


def validate_songs(pieces: list[Piece]) -> list[str]:
    """Problems across the levels of one song (ADR 0012): the rights and the labels must agree."""
    errors: list[str] = []
    by_song: dict[str, list[Piece]] = {}
    for p in pieces:
        if p.record.get("song"):
            by_song.setdefault(p.record["song"], []).append(p)
    same = ("composer", "composer_death_year", "traditional", "composer_wikidata", "lyricist", "lyricist_death_year")
    for song, group in sorted(by_song.items()):
        first = group[0]
        for other in group[1:]:
            for key in same:
                if first.record.get(key) != other.record.get(key):
                    errors.append(
                        f"song '{song}': {first.slug} and {other.slug} disagree on {key} "
                        f"({first.record.get(key)!r} against {other.record.get(key)!r})"
                    )
        labels = [g.record.get("variant", "").strip().lower() for g in group]
        if len(set(labels)) != len(labels):
            errors.append(f"song '{song}': two levels have the same variant label")
    return errors
