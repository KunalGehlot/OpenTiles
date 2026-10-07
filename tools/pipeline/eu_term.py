"""EU copyright-term check (spec §9, step 2). CC0 1.0.

In the EU (and Germany, the operator's jurisdiction) copyright lasts for the author's life plus
70 years, ending on 31 December of that 70th year. A work is therefore free from 1 January of the
71st year after the author's death: for a 2026 catalogue release, authors who died in 1955 or
earlier.
"""

from __future__ import annotations


def latest_free_death_year(release_year: int) -> int:
    return release_year - 71


def is_free(death_year: int | None, release_year: int, traditional: bool = False) -> bool:
    """True when every creator's work is out of copyright in the EU in `release_year`."""
    if traditional and death_year is None:
        return True
    if death_year is None:
        return False
    return death_year <= latest_free_death_year(release_year)
