#!/usr/bin/env python3
"""Composer and lyricist death years from Wikidata (spec §9, step 2). CC0 1.0.

The EU term check needs a death year for every named creator. This module looks a name up with
the Wikidata API (`wbsearchentities`, then `wbgetentities` for P31 "instance of", P106
"occupation", P569 "date of birth" and P570 "date of death") and keeps what it learnt in an
on-disk JSON cache that is committed to the repository (catalogue/cache/wikidata.json). Checks
and CI read the cache only; the network is used only when a contributor asks for it.

A name resolves only when the answer is unambiguous: one human with a musical or literary
occupation, or several whose death years agree. Anything else is reported as ambiguous so a
person can pin the right item with `composer_wikidata` / `lyricist_wikidata` in provenance.json.

Death years are read conservatively: when a date is only known to the decade or century, the
latest year it could be is used, so a term check can only err on the safe side.

Usage:
    wikidata.py lookup NAME [--offline]     resolve one name and print the result
    wikidata.py update [--offline]          resolve every catalogue creator into the cache
"""

from __future__ import annotations

import argparse
import datetime
import json
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from catalogue_lib import load_pieces

API = "https://www.wikidata.org/w/api.php"
USER_AGENT = "OpenTiles-catalogue-pipeline/1.0 (https://github.com/KunalGehlot/OpenTiles; catalogue term check)"
CACHE_PATH = Path(__file__).resolve().parents[2] / "catalogue" / "cache" / "wikidata.json"
CACHE_VERSION = 1

HUMAN = "Q5"
# Occupations that make a search hit a plausible composer or lyricist. Anything else (a painter
# or a footballer with the same name) is ignored.
CREATIVE_OCCUPATIONS = {
    "Q36834": "composer",
    "Q639669": "musician",
    "Q486748": "pianist",
    "Q765778": "organist",
    "Q158852": "conductor",
    "Q753110": "songwriter",
    "Q822146": "lyricist",
    "Q49757": "poet",
    "Q36180": "writer",
    "Q8178443": "librettist",
    "Q177220": "singer",
    "Q1259917": "violinist",
    "Q16031530": "music theorist",
    "Q14915627": "musicologist",
    "Q1415090": "film score composer",
}

# Wikidata time precision: 9 = year, 8 = decade, 7 = century.
PRECISION_YEAR = 9
PRECISION_DECADE = 8
PRECISION_CENTURY = 7

Fetcher = Callable[[dict], dict]
QID_TEXT = re.compile(r"^Q[1-9][0-9]*$")


class WikidataError(RuntimeError):
    pass


def http_fetcher(min_interval: float = 1.0, retries: int = 4) -> Fetcher:
    """A polite fetcher: descriptive User-Agent, one request per `min_interval`, backs off on 429."""
    last = [0.0]

    def fetch(params: dict) -> dict:
        query = urllib.parse.urlencode({**params, "format": "json"})
        req = urllib.request.Request(f"{API}?{query}", headers={"User-Agent": USER_AGENT})
        for attempt in range(retries + 1):
            wait = last[0] + min_interval - time.monotonic()
            if wait > 0:
                time.sleep(wait)
            last[0] = time.monotonic()
            try:
                with urllib.request.urlopen(req, timeout=30) as resp:
                    return json.loads(resp.read().decode("utf-8"))
            except urllib.error.HTTPError as e:
                if e.code not in (429, 500, 502, 503, 504) or attempt == retries:
                    raise WikidataError(f"Wikidata API returned HTTP {e.code}") from e
                time.sleep(float(e.headers.get("Retry-After") or 2 ** (attempt + 1)))
            except (urllib.error.URLError, TimeoutError) as e:
                if attempt == retries:
                    raise WikidataError(f"Wikidata API unreachable: {e}") from e
                time.sleep(2 ** (attempt + 1))
        raise WikidataError("unreachable")  # pragma: no cover

    return fetch


def normalise_name(name: str) -> str:
    """Cache key for a name: Unicode-normalised, case-folded, single spaces."""
    return " ".join(unicodedata.normalize("NFKC", name).casefold().split())


# --- reading entities -----------------------------------------------------------------------


def _claim_values(entity: dict, prop: str) -> list[tuple[str, dict | None]]:
    """(rank, datavalue) for each non-deprecated statement; preferred ones only when any exist."""
    out = []
    for claim in entity.get("claims", {}).get(prop, []):
        rank = claim.get("rank", "normal")
        if rank == "deprecated":
            continue
        snak = claim.get("mainsnak", {})
        out.append((rank, snak.get("datavalue") if snak.get("snaktype") == "value" else None))
    preferred = [c for c in out if c[0] == "preferred"]
    return preferred or out


def _latest_year(value: dict) -> tuple[int, int] | None:
    """Latest possible year of a Wikidata time value, and its precision; None when too vague."""
    time_str = value.get("time", "")
    precision = int(value.get("precision", 0))
    try:
        sign = -1 if time_str.startswith("-") else 1
        year = sign * int(time_str.lstrip("+-").split("-", 1)[0])
    except ValueError:
        return None
    if precision >= PRECISION_YEAR:
        return year, precision
    if precision == PRECISION_DECADE:
        return year - year % 10 + 9, precision
    if precision == PRECISION_CENTURY:
        # Wikidata stores the 19th century as any year in 1801–1900; its last year is 1900.
        return (year - 1) // 100 * 100 + 100, precision
    return None


def _year_of(entity: dict, prop: str) -> tuple[int | None, int | None]:
    best: tuple[int, int] | None = None
    for _rank, value in _claim_values(entity, prop):
        if value is None or value.get("type") != "time":
            continue
        got = _latest_year(value["value"])
        if got and (best is None or got[0] > best[0]):
            best = got
    return (best[0], best[1]) if best else (None, None)


def _item_ids(entity: dict, prop: str) -> list[str]:
    ids = []
    for _rank, value in _claim_values(entity, prop):
        if value and value.get("type") == "wikibase-entityid":
            ids.append(value["value"]["id"])
    return ids


def distil_entity(entity: dict, fetched: str) -> dict:
    """The few facts the term check needs, small enough to commit."""
    death_year, death_precision = _year_of(entity, "P570")
    birth_year, _ = _year_of(entity, "P569")
    has_death_claim = bool(entity.get("claims", {}).get("P570"))
    return {
        "label": entity.get("labels", {}).get("en", {}).get("value", ""),
        "description": entity.get("descriptions", {}).get("en", {}).get("value", ""),
        "aliases": sorted(a["value"] for a in entity.get("aliases", {}).get("en", [])),
        "human": HUMAN in _item_ids(entity, "P31"),
        "occupations": sorted(set(_item_ids(entity, "P106")) & CREATIVE_OCCUPATIONS.keys()),
        "birth_year": birth_year,
        "death_year": death_year,
        "death_precision": death_precision,
        # Dead but the date is unknown ("some value") is different from "no death recorded".
        "death_unknown": has_death_claim and death_year is None,
        "fetched": fetched,
    }


# --- cache ------------------------------------------------------------------------------------


@dataclass
class Cache:
    path: Path | None = CACHE_PATH
    names: dict[str, dict] = field(default_factory=dict)
    entities: dict[str, dict] = field(default_factory=dict)
    dirty: bool = False

    @classmethod
    def load(cls, path: Path | None = CACHE_PATH) -> "Cache":
        if path is None or not path.exists():
            return cls(path)
        data = json.loads(path.read_text(encoding="utf-8"))
        if data.get("version") != CACHE_VERSION:
            raise WikidataError(f"{path}: unsupported cache version {data.get('version')}")
        return cls(path, data.get("names", {}), data.get("entities", {}))

    def dumps(self) -> str:
        data = {
            "version": CACHE_VERSION,
            "source": "Wikidata (https://www.wikidata.org), CC0 1.0. Written by tools/pipeline/wikidata.py.",
            "names": dict(sorted(self.names.items())),
            "entities": dict(sorted(self.entities.items(), key=lambda kv: int(kv[0][1:]))),
        }
        return json.dumps(data, indent=2, ensure_ascii=False) + "\n"

    def save(self) -> None:
        if self.path is None or not self.dirty:
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(self.dumps(), encoding="utf-8")
        self.dirty = False


# --- lookups ------------------------------------------------------------------------------------


@dataclass
class Match:
    """Outcome of resolving one creator."""

    status: str  # "found", "ambiguous", "not-found" or "not-cached"
    name: str
    qid: str | None = None
    entity: dict | None = None
    candidates: list[str] = field(default_factory=list)
    candidate_years: list[int | None] = field(default_factory=list)

    @property
    def death_year(self) -> int | None:
        return self.entity["death_year"] if self.entity else None

    @property
    def latest_death_year(self) -> int | None:
        """For an ambiguous name: the latest death year of all candidates, None if any is unknown.

        Whichever candidate wrote the work, it is free once this year is out of term.
        """
        years = self.candidate_years
        if not years or any(y is None for y in years):
            return None
        return max(y for y in years if y is not None)


class Wikidata:
    """Resolves names and item IDs through the cache, fetching misses unless offline."""

    def __init__(self, cache: Cache, fetch: Fetcher | None = None, today: str | None = None):
        self.cache = cache
        self.fetch = fetch  # None means offline: the cache is the only source
        self.today = today or datetime.date.today().isoformat()

    def _get_entities(self, ids: list[str]) -> None:
        missing = [i for i in ids if i not in self.cache.entities]
        if not missing or self.fetch is None:
            return
        for start in range(0, len(missing), 50):  # API limit per request
            chunk = missing[start : start + 50]
            data = self.fetch(
                {
                    "action": "wbgetentities",
                    "ids": "|".join(chunk),
                    "props": "labels|aliases|descriptions|claims",
                    "languages": "en",
                }
            )
            if "error" in data:
                raise WikidataError(f"wbgetentities: {data['error'].get('info', data['error'])}")
            for qid, entity in data.get("entities", {}).items():
                if "missing" in entity:
                    continue
                self.cache.entities[qid] = distil_entity(entity, self.today)
                self.cache.dirty = True

    def by_id(self, qid: str, name: str = "") -> Match:
        self._get_entities([qid])
        entity = self.cache.entities.get(qid)
        if entity is None:
            return Match("not-cached" if self.fetch is None else "not-found", name or qid, qid)
        return Match("found", name or entity["label"], qid, entity)

    def _search(self, name: str) -> list[str] | None:
        key = normalise_name(name)
        if key in self.cache.names:
            return self.cache.names[key]["ids"]
        if self.fetch is None:
            return None
        data = self.fetch(
            {
                "action": "wbsearchentities",
                "search": name,
                "language": "en",
                "uselang": "en",
                "type": "item",
                "limit": "10",
            }
        )
        if "error" in data:
            raise WikidataError(f"wbsearchentities: {data['error'].get('info', data['error'])}")
        hits = [h["id"] for h in data.get("search", [])]
        known = set(self.cache.entities)
        self._get_entities(hits)
        # Keep only the hits that can be creators; the rest would just bloat the cache. Items
        # cached earlier stay (a pinned QID need not list a creative occupation).
        ids = [h for h in hits if _is_creator(self.cache.entities.get(h))]
        for h in hits:
            if h not in ids and h not in known:
                self.cache.entities.pop(h, None)
        self.cache.names[key] = {"ids": ids, "fetched": self.today}
        self.cache.dirty = True
        return ids

    def by_name(self, name: str) -> Match:
        ids = self._search(name)
        if ids is None:
            return Match("not-cached", name)
        candidates = [i for i in ids if _is_creator(self.cache.entities.get(i))]
        if not candidates:
            return Match("not-found", name)
        exact = [i for i in candidates if _name_matches(self.cache.entities[i], name)]
        pool = exact or candidates
        years = {self.cache.entities[i]["death_year"] for i in pool}
        if len(pool) == 1 or (len(years) == 1 and None not in years):
            return Match("found", name, pool[0], self.cache.entities[pool[0]], pool)
        pool_years = [self.cache.entities[i]["death_year"] for i in pool]
        return Match("ambiguous", name, candidates=pool, candidate_years=pool_years)


def _is_creator(entity: dict | None) -> bool:
    return bool(entity and entity["human"] and entity["occupations"])


def _fold(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", text.casefold())
    return " ".join("".join(c for c in decomposed if not unicodedata.combining(c)).split())


def _name_matches(entity: dict, name: str) -> bool:
    want = _fold(name)
    return any(_fold(n) == want for n in [entity["label"], *entity["aliases"]])


# --- provenance check ---------------------------------------------------------------------------


def check_record(record: dict, wd: Wikidata) -> tuple[list[str], list[str]]:
    """Compare a provenance record's death years with Wikidata: (errors, notes).

    A disagreement is an error. A creator Wikidata cannot settle (not cached, not found,
    ambiguous) is only a note: the reviewer then checks the year by hand (REVIEWING.md).
    """
    errors: list[str] = []
    notes: list[str] = []
    roles = []
    if not (record.get("traditional") and record.get("composer_death_year") is None):
        roles.append("composer")
    if record.get("lyricist"):
        roles.append("lyricist")
    for role in roles:
        name, year, qid = record.get(role), record.get(f"{role}_death_year"), record.get(f"{role}_wikidata")
        if not name:
            continue
        match = wd.by_id(qid, name) if qid else wd.by_name(name)
        if match.status == "found":
            if qid and match.entity and not _name_matches(match.entity, name):
                notes.append(f"{role} {name}: the pinned item {qid} is labelled '{match.entity['label']}'; check it")
            if match.death_year is None:
                if match.entity and match.entity.get("death_unknown"):
                    notes.append(f"{role} {name}: Wikidata ({match.qid}) has no exact death date")
                else:
                    errors.append(
                        f"{role} {name}: Wikidata ({match.qid}) records no death, so the term cannot be checked"
                    )
            elif year != match.death_year:
                errors.append(
                    f"{role}_death_year is {year} but Wikidata ({match.qid}) says {match.death_year}; "
                    f"fix the record or pin the right item with {role}_wikidata"
                )
        elif match.status == "ambiguous":
            notes.append(
                f"{role} {name}: several Wikidata matches ({', '.join(match.candidates[:5])}); "
                f"set {role}_wikidata to the right one"
            )
        elif match.status == "not-found":
            notes.append(f"{role} {name}: no matching person on Wikidata; check the death year by hand")
        else:
            notes.append(f"{role} {name}: not in the Wikidata cache; run tools/pipeline/wikidata.py update")
    return errors, notes


def catalogue_creators(pieces: list) -> list[tuple[str, str | None]]:
    """(name, pinned QID) for every non-traditional creator in the catalogue."""
    out = []
    for piece in pieces:
        r = piece.record
        if r.get("composer") and not (r.get("traditional") and r.get("composer_death_year") is None):
            out.append((r["composer"], r.get("composer_wikidata")))
        if r.get("lyricist"):
            out.append((r["lyricist"], r.get("lyricist_wikidata")))
    return sorted(set(out), key=lambda t: (t[0], t[1] or ""))


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--offline", action="store_true", help="use the cache only")
    ap.add_argument("--cache", type=Path, default=CACHE_PATH)
    sub = ap.add_subparsers(dest="cmd", required=True)
    look = sub.add_parser("lookup")
    look.add_argument("name")
    sub.add_parser("update")
    args = ap.parse_args(argv)

    cache = Cache.load(args.cache)
    wd = Wikidata(cache, None if args.offline else http_fetcher())
    try:
        if args.cmd == "lookup":
            m = wd.by_id(args.name) if QID_TEXT.match(args.name) else wd.by_name(args.name)
            result = {"status": m.status, "qid": m.qid, "candidates": m.candidates, "entity": m.entity}
            print(json.dumps(result, indent=2, ensure_ascii=False))
        else:
            for name, qid in catalogue_creators(load_pieces()):
                m = wd.by_id(qid, name) if qid else wd.by_name(name)
                print(f"{m.status:11} {name}: {m.qid or '-'} died {m.death_year}")
    except WikidataError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    finally:
        cache.save()
    return 0


if __name__ == "__main__":
    sys.exit(main())
