#!/usr/bin/env python3
"""Filter the PDMX metadata down to catalogue candidates (spec §9, step 1). CC0 1.0.

PDMX (https://zenodo.org/records/15571083, paper https://arxiv.org/abs/2409.10831) ships one
metadata table, PDMX.csv, with a row per score. The columns used here:

    path, mxl, metadata           files inside the dataset archives
    license, license_url          "publicdomain" (PD mark) or "cc-zero" (CC0 dedication)
    license_conflict              the MuseScore file's internal licence disagrees with the page
    subset:no_license_conflict    the subset the dataset authors recommend (spec §9)
    subset:all_valid              MXL, PDF and MIDI files all exist
    subset:deduplicated           one best arrangement per song
    tracks, n_tracks              General MIDI programme of each track, joined by "-"
    rating, n_ratings             MuseScore user rating (0–5) and how many people rated
    complexity                    MuseScore difficulty tag: 0 unset, 1 beginner, 2 intermediate,
                                  3 advanced
    n_notes, notes_per_bar, song_length.seconds, song_length.bars, pitch_class_entropy
    title, song_name, subtitle, artist_name, composer_name, publisher, tags, groups, genres

Filters, in order, each counted in the report:

1. `subset:no_license_conflict` is True (about 12 % of PDMX has mismatched licence data);
2. `subset:all_valid` is True, so the MXL file exists;
3. piano only: every track uses a General MIDI piano programme (0–7 by default) and there are at
   most two tracks (one grand-staff part, or one part per hand);
4. rated: at least `--min-ratings` ratings and an average of at least `--min-rating`;
5. optionally `--deduplicated`;
6. edition rules (editions.py, spec §9 step 3): "exclude" rows are dropped; "review" rows are
   kept with their reasons unless `--strict-editions`.

The candidates CSV keeps the complexity and size columns for difficulty scoring (P2-05) and a
cleaned `composer_guess` for the EU term check (step 2). With `--term-check cache|online` the
composer is also looked up on Wikidata (wikidata.py) and the result written next to it.

Usage:
    pdmx_filter.py PDMX.csv [-o tools/pipeline/data/pdmx_candidates.csv] [--min-rating 4.0]
                   [--min-ratings 3] [--max-tracks 2] [--programs 0-7] [--deduplicated]
                   [--strict-editions] [--term-check off|cache|online] [--release-year YEAR]
"""

from __future__ import annotations

import argparse
import csv
import datetime
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, Iterator

import editions
import wikidata
from eu_term import is_free

DEFAULT_OUT = Path(__file__).resolve().parent / "data" / "pdmx_candidates.csv"
PIANO_PROGRAMS = frozenset(range(8))  # General MIDI "Piano" family, programmes 1–8

OUT_COLUMNS = [
    "path",
    "mxl",
    "metadata",
    "title",
    "song_name",
    "subtitle",
    "composer_name",
    "artist_name",
    "composer_guess",
    "license",
    "license_url",
    "rating",
    "n_ratings",
    "complexity",
    "n_tracks",
    "tracks",
    "n_notes",
    "notes_per_bar",
    "song_length.seconds",
    "song_length.bars",
    "pitch_class_entropy",
    "has_lyrics",
    "genres",
    "tags",
    "edition_status",
    "edition_reasons",
]
TERM_COLUMNS = ["wikidata_id", "composer_death_year", "eu_term"]


@dataclass
class Options:
    min_rating: float = 4.0
    min_ratings: int = 3
    max_tracks: int = 2
    programs: frozenset[int] = PIANO_PROGRAMS
    deduplicated: bool = False
    strict_editions: bool = False


@dataclass
class Report:
    counts: dict[str, int] = field(default_factory=dict)
    edition: dict[str, int] = field(default_factory=lambda: {"keep": 0, "review": 0, "exclude": 0})
    complexity: dict[str, int] = field(default_factory=dict)

    def step(self, name: str) -> None:
        self.counts[name] = self.counts.get(name, 0) + 1

    def lines(self) -> list[str]:
        out = [f"{name:32} {n:>8}" for name, n in self.counts.items()]
        out.append("edition verdicts: " + ", ".join(f"{k} {v}" for k, v in self.edition.items()))
        if self.complexity:
            labels = {"0": "unset", "1": "beginner", "2": "intermediate", "3": "advanced"}
            out.append(
                "complexity of candidates: "
                + ", ".join(f"{labels.get(k, k)} {v}" for k, v in sorted(self.complexity.items()))
            )
        return out


def truthy(value: str | None) -> bool:
    return (value or "").strip().lower() in ("true", "1", "yes")


def parse_programs(text: str) -> frozenset[int]:
    """'0-7' or '0,1,2' or '0-3,6' → set of General MIDI programmes."""
    out: set[int] = set()
    for part in text.split(","):
        lo, _, hi = part.strip().partition("-")
        out.update(range(int(lo), int(hi or lo) + 1))
    return frozenset(out)


def track_programs(row: dict) -> list[int] | None:
    raw = (row.get("tracks") or "").strip()
    if not raw or raw.upper() == "NA":
        return None
    try:
        return [int(p) for p in raw.split("-")]
    except ValueError:
        return None


def no_licence_conflict(row: dict) -> bool:
    if "subset:no_license_conflict" in row:
        return truthy(row["subset:no_license_conflict"])
    return not truthy(row.get("license_conflict"))


def is_piano_only(row: dict, opts: Options) -> bool:
    programs = track_programs(row)
    if not programs:
        return False
    try:
        n_tracks = int(row.get("n_tracks") or len(programs))
    except ValueError:
        return False
    return 1 <= n_tracks <= opts.max_tracks and all(p in opts.programs for p in programs)


def is_rated(row: dict, opts: Options) -> bool:
    try:
        rating = float(row.get("rating") or 0)
        n_ratings = int(float(row.get("n_ratings") or 0))
    except ValueError:
        return False
    return n_ratings >= opts.min_ratings and rating >= opts.min_rating


# A UTF-8 lead byte read as Latin-1/CP-1252, then a continuation byte read the same way.
_MOJIBAKE = re.compile(r"[\u00c2-\u00f4][\u0080-\u00bf\u0152-\u0192\u02c6\u02dc\u2013-\u2122]")


def fix_mojibake(text: str) -> str:
    """Undo UTF-8 read as Latin-1/CP-1252 ('DvoÅ\x99Ã¡k' → 'Dvořák'); leave other text alone."""
    if not _MOJIBAKE.search(text):
        return text
    for codec in ("latin-1", "cp1252"):
        try:
            return text.encode(codec).decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            continue
    return text


_YEARS = re.compile(r"[\(\[]?\s*(?:c\.\s*)?\d{3,4}\s*[-–—/]\s*(?:c\.\s*)?\d{0,4}\s*[\)\]]?")
_TRAILING_YEARS = re.compile(r"(?:\s*[\(\[]?\s*(?:c\.|ca\.|b\.|d\.)?\s*\d{3,4}\s*[\)\]]?)+\s*$", re.I)
_ARRANGER = re.compile(
    r"\s*(?:,|;|/|\||-|–)?\s*(?:(?<![a-z])arr\b\.?|arr\.|arranged\b|arrgt\b|transcribed\b|transcription\b|edited\b|ed\.\s|"
    r"piano arrangement\b|revised\b|composed by\b|realizations?\b|https?://).*$",
    re.I,
)
_PLACEHOLDER = {"", "na", "composer", "unknown", "various", "various artists", "misc", "anonymous composer"}
_TRADITIONAL = re.compile(r"^(?:trad\.?|traditional|anon\.?|anonymous|folk(?:\s+song)?)\b", re.I)


def clean_composer(row: dict) -> str:
    """Best guess at the composer's plain name from the free-text composer and artist fields."""
    for key in ("composer_name", "artist_name"):
        raw = fix_mojibake((row.get(key) or "").strip())
        if raw.upper() == "NA":
            continue
        name = re.sub(r"^composed by\s+", "", raw, flags=re.I)
        name = _ARRANGER.sub("", name)
        name = _YEARS.sub(" ", name)
        name = _TRAILING_YEARS.sub("", name)
        name = re.sub(r"\s+", " ", name).strip(" ,;:-–")
        # MuseScore files anonymous uploads under artists such as "Misc Traditional".
        misc = re.match(r"^misc\.?\s+(.*)$", name, re.I)
        if misc:
            name = "Traditional" if "traditional" in misc.group(1).lower() else ""
        if _TRADITIONAL.match(name):
            return "Traditional"
        if name.lower() not in _PLACEHOLDER:
            return name
    return ""


def filter_rows(rows: Iterable[dict], opts: Options, report: Report) -> Iterator[dict]:
    for row in rows:
        report.step("rows read")
        if not no_licence_conflict(row):
            continue
        report.step("no_license_conflict")
        if not truthy(row.get("subset:all_valid", "True")):
            continue
        report.step("all files valid")
        if not is_piano_only(row, opts):
            continue
        report.step("piano only")
        if not is_rated(row, opts):
            continue
        report.step(f"rated >= {opts.min_rating:g} by >= {opts.min_ratings}")
        if opts.deduplicated and not truthy(row.get("subset:deduplicated")):
            continue
        if opts.deduplicated:
            report.step("deduplicated")
        verdict = editions.judge_pdmx(row)
        report.edition[verdict.status] += 1
        if verdict.status == "exclude" or (opts.strict_editions and verdict.status == "review"):
            continue
        report.step("edition rules")
        complexity = (row.get("complexity") or "").strip() or "?"
        report.complexity[complexity] = report.complexity.get(complexity, 0) + 1
        out = {k: fix_mojibake(row.get(k, "") or "") for k in OUT_COLUMNS if k in row}
        out["composer_guess"] = clean_composer(row)
        out["edition_status"] = verdict.status
        out["edition_reasons"] = "; ".join(verdict.reasons)
        yield out


def add_term_check(rows: Iterable[dict], wd: wikidata.Wikidata, release_year: int) -> Iterator[dict]:
    """Annotate rows with the composer's Wikidata death year and the EU term result."""
    for row in rows:
        name = row.get("composer_guess", "")
        row["wikidata_id"] = ""
        row["composer_death_year"] = ""
        if name == "Traditional":
            row["eu_term"] = "traditional"
        elif not name:
            row["eu_term"] = "unknown"
        else:
            try:
                match = wd.by_name(name)
            except wikidata.WikidataError as e:  # network trouble: finish from the cache
                print(f"Wikidata lookups stopped: {e}", file=sys.stderr)
                wd.fetch = None
                match = wd.by_name(name)
            if match.status == "found":
                row["wikidata_id"] = match.qid or ""
                year = match.death_year
                row["composer_death_year"] = "" if year is None else str(year)
                row["eu_term"] = "pass" if is_free(year, release_year) else "fail"
            elif match.status == "ambiguous" and is_free(match.latest_death_year, release_year):
                # Several people share the name, but every one of them died long enough ago.
                row["wikidata_id"] = "|".join(match.candidates)
                row["composer_death_year"] = str(match.latest_death_year)
                row["eu_term"] = "pass"
            else:
                row["eu_term"] = match.status
        yield row


def run(src: Path, dest: Path, opts: Options, term_check: str = "off", release_year: int | None = None) -> Report:
    report = Report()
    csv.field_size_limit(min(sys.maxsize, 2**31 - 1))
    dest.parent.mkdir(parents=True, exist_ok=True)
    wd = None
    if term_check != "off":
        wd = wikidata.Wikidata(
            wikidata.Cache.load(), wikidata.http_fetcher() if term_check == "online" else None
        )
    with src.open(newline="", encoding="utf-8") as fin, dest.open("w", newline="", encoding="utf-8") as fout:
        columns = OUT_COLUMNS + (TERM_COLUMNS if wd else [])
        writer = csv.DictWriter(fout, fieldnames=columns, extrasaction="ignore")
        writer.writeheader()
        rows = filter_rows(csv.DictReader(fin), opts, report)
        if wd is not None:
            rows = add_term_check(rows, wd, release_year or datetime.date.today().year)
        try:
            for row in rows:
                writer.writerow(row)
        finally:
            if wd is not None:
                wd.cache.save()
    return report


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("csv", type=Path, help="PDMX.csv from the dataset")
    ap.add_argument("-o", "--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--min-rating", type=float, default=Options.min_rating)
    ap.add_argument("--min-ratings", type=int, default=Options.min_ratings)
    ap.add_argument("--max-tracks", type=int, default=Options.max_tracks)
    ap.add_argument("--programs", type=parse_programs, default=PIANO_PROGRAMS, help="General MIDI programmes, e.g. 0-7")
    ap.add_argument("--deduplicated", action="store_true", help="keep only PDMX's deduplicated subset")
    ap.add_argument("--strict-editions", action="store_true", help="also drop rows the edition rules want reviewed")
    ap.add_argument("--term-check", choices=("off", "cache", "online"), default="off")
    ap.add_argument("--release-year", type=int, default=datetime.date.today().year)
    args = ap.parse_args(argv)
    opts = Options(args.min_rating, args.min_ratings, args.max_tracks, args.programs, args.deduplicated, args.strict_editions)
    report = run(args.csv, args.out, opts, args.term_check, args.release_year)
    for line in report.lines():
        print(line)
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
