#!/usr/bin/env python3
"""Writes catalogue/index.json from the pieces' provenance records. CC0 1.0.

The web app lists catalogue pieces from this file. Unverified pieces are included with
"verified": false; production builds show only verified ones (spec §2: the home page lists only
verified public-domain or CC0 scores). A named composer's years of birth and death come from the
committed Wikidata cache (CC0), for the Player's programme, and only when the cache's death year is
the record's: the provenance record stays the authority.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from catalogue_lib import CATALOGUE, Piece, index_entry, load_pieces
from wikidata import Cache, normalise_name


def index_path() -> Path:
    return CATALOGUE / "index.json"


def composer_years(record: dict, cache: Cache) -> list[int] | None:
    """[born, died] of the record's composer, or None for a traditional or unknown one."""
    died = record.get("composer_death_year")
    if record.get("traditional") or not died:
        return None
    qid = record.get("composer_wikidata")
    ids = [qid] if qid else cache.names.get(normalise_name(record["composer"]), {}).get("ids", [])
    for i in ids:
        entity = cache.entities.get(i) or {}
        if entity.get("death_year") == died and entity.get("birth_year"):
            return [entity["birth_year"], died]
    return None


def build_index(pieces: list[Piece], cache: Cache | None = None) -> str:
    cache = cache if cache is not None else Cache.load()
    entries = [index_entry(p, composer_years(p.record, cache)) for p in pieces if p.record]
    entries.sort(key=lambda e: (e["difficulty"], e["title"].lower()))
    return json.dumps({"version": 1, "pieces": entries}, indent=2, ensure_ascii=False) + "\n"


def main() -> int:
    index_path().write_text(build_index(load_pieces()), encoding="utf-8")
    print(f"wrote {index_path().relative_to(CATALOGUE.parent)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
