"""Protected-edition rules (spec §9, step 3). CC0 1.0.

German law protects scholarly editions (§ 70 UrhG, 25 years) and first editions of works never
published before (§ 71 UrhG, 25 years) on top of the composer's own copyright. A score copied
from such an edition is not free even when the composer died centuries ago. The catalogue
therefore keeps only files that are the transcriber's own work released as CC0, never scans,
OCR/OMR output or copies of a publisher's edition.

Metadata cannot prove where notes came from, so these rules sort candidates into three groups:

- "exclude": the metadata names a publisher or scholarly edition, a scan or music OCR, or a
  first edition. Dropped automatically.
- "review": something needs a person to look (a PD mark instead of a CC0 dedication, an
  IMSLP or "edited by" mention, an arrangement by someone else). Kept, with the reasons.
- "keep": nothing suspicious and the uploader dedicated the file to the public domain.

Keyword matches inside a negated clause ("not copied from any published edition") are ignored.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

# Publisher and scholarly-edition names. Only phrases that rarely mean anything else: a bare
# "Peters" or "Durand" is also a surname, so those need a publisher context.
PUBLISHERS = [
    r"urtext",
    r"\bhenle\b",
    r"b(?:ä|ae|a)renreiter",
    r"edition\s+peters|peters\s+edition|c\.\s*f\.\s*peters",
    r"breitkopf\s*(?:&|und|and)\s*h(?:ä|ae|a)rtel|breitkopf\s+edition|edition\s+breitkopf",
    r"g\.\s*schirmer|schirmer'?s\s+library",
    r"schott\s+music|edition\s+schott|schott\s+edition|b\.\s*schott",
    r"universal\s+edition",
    r"boosey",
    r"hal\s+leonard",
    r"alfred\s+(?:music|publishing)",
    r"faber\s+(?:music|piano)",
    r"\bg\.\s*ricordi\b|casa\s+ricordi|edizioni\s+ricordi|ricordi\s+(?:&|e)\s+c\b",
    r"(?:é|e)ditions\s+durand|durand\s+(?:&|et)\s+cie",
    r"musikverlag|\bverlag\b",
    r"wiener\s+urtext",
    r"carus[-\s]verlag",
]
SCHOLARLY = [
    r"critical\s+edition",
    r"scholarly\s+edition",
    r"kritische\s+ausgabe",
    r"gesamtausgabe",
    r"neue\s+\w+[-\s]ausgabe",
    r"complete\s+works\s+edition",
]
FIRST_EDITION = [
    r"first\s+edition",
    r"erstausgabe",
    r"erstdruck",
    r"editio\s+princeps",
]
SCAN = [
    r"\bscan(?:ned|s)?\b",
    r"\bomr\b",
    r"photoscore",
    r"playscore",
    r"smartscore",
    r"audiveris",
    r"sharpeye",
    r"capella[-\s]scan",
    r"facsimile|faksimile",
    r"(?:imported|converted)\s+from\s+(?:a\s+)?pdf|pdf\s+(?:import|to\s+musicxml)",
]
# Soft signs: kept, but a reviewer must look.
NEEDS_REVIEW = [
    (r"\bimslp\b", "mentions IMSLP: check it was not copied from a scanned edition"),
    (r"edited\s+by|\bed\.\s+by|\beditor\b", "names an editor: check the source edition is not protected"),
    (r"\bedition\b", "mentions an edition: check which one"),
    (r"manuscript|autograph", "mentions a manuscript: check it is not a first edition (§ 71 UrhG)"),
    (r"copied\s+from|taken\s+from|as\s+(?:published|printed)|from\s+the\s+book", "says it was copied from a source"),
    (r"\bengrav(?:ed|ing)\s+by\b", "credits an engraver: check the engraving is the uploader's own"),
]
ARRANGED = re.compile(r"\barr(?:\.|anged\b|angement\b)", re.I)
# "No 3" is a number, not a negation.
NEGATION = re.compile(r"\b(?:not|never|without|nicht|kein\w*|nie)\b|\bno\b(?!\s*\d)", re.I)
CLAUSE = re.compile(r"[.;:!?,\n()\[\]|]+")

HARD_RULES = (
    [(p, "names a publisher or Urtext edition") for p in PUBLISHERS]
    + [(p, "names a scholarly edition (§ 70 UrhG)") for p in SCHOLARLY]
    + [(p, "names a first edition (§ 71 UrhG)") for p in FIRST_EDITION]
    + [(p, "looks like a scan or music OCR, not an own transcription") for p in SCAN]
)
_HARD = [(re.compile(p, re.I), why) for p, why in HARD_RULES]
_SOFT = [(re.compile(p, re.I), why) for p, why in NEEDS_REVIEW]

# What counts as evidence that a catalogue file is the transcriber's own work.
OWN_WORK = re.compile(
    r"\b(?:own|original)\b[^.;]*\b(?:transcription|arrangement|engraving|typesetting|setting)\b"
    r"|\b(?:arranged|transcribed|written|typeset|engraved)\s+(?:for\s+opentiles|by\s+the\s+(?:uploader|transcriber))\b",
    re.I,
)


@dataclass
class Verdict:
    status: str  # "keep", "review" or "exclude"
    reasons: list[str] = field(default_factory=list)


def find(text: str, rules: list[tuple[re.Pattern[str], str]]) -> list[str]:
    """Reasons whose pattern occurs in `text` outside a negated clause."""
    found: list[str] = []
    for clause in CLAUSE.split(text or ""):
        for pattern, why in rules:
            for m in pattern.finditer(clause):
                if NEGATION.search(clause[: m.start()]):
                    continue
                reason = f"{why} ('{m.group(0)}')"
                if reason not in found:
                    found.append(reason)
    return found


def _truthy(value: object) -> bool:
    return str(value).strip().lower() in ("true", "1", "yes")


def _present(value: object) -> bool:
    return bool(value) and str(value).strip().upper() not in ("NA", "NAN", "NONE", "")


def judge_pdmx(row: dict) -> Verdict:
    """Edition verdict for one PDMX metadata row (column names as in PDMX.csv)."""
    hard: list[str] = []
    soft: list[str] = []
    if _present(row.get("publisher")):
        hard.append(f"the score names a publisher ('{row['publisher']}')")
    if _truthy(row.get("is_user_publisher")):
        hard.append("uploaded by a publisher account")
    if _truthy(row.get("is_official")):
        hard.append("an official (publisher-licensed) score")
    text = " | ".join(
        str(row.get(k, "")) for k in ("title", "subtitle", "song_name", "artist_name", "composer_name", "tags", "groups", "description")
        if _present(row.get(k))
    )
    hard += find(text, _HARD)
    if hard:
        return Verdict("exclude", hard)
    soft += find(text, _SOFT)
    licence = str(row.get("license", "")).strip().lower()
    if licence != "cc-zero":
        soft.append(
            f"licence is '{licence or 'missing'}', not a CC0 dedication: no evidence the file is the uploader's own transcription"
        )
        if ARRANGED.search(text):
            soft.append("an arrangement under a public-domain mark: check the arranger released it")
    return Verdict("review" if soft else "keep", soft)


def check_provenance(record: dict) -> tuple[list[str], list[str]]:
    """(errors, notes) for a catalogue provenance record's edition evidence."""
    note = record.get("edition_note", "") or ""
    text = " | ".join(str(record.get(k, "") or "") for k in ("edition_note", "transcriber", "arranger", "source_url"))
    errors = [f"edition: {r}" for r in find(text, _HARD)]
    if not OWN_WORK.search(note):
        errors.append(
            "edition_note must say the score is the transcriber's own transcription or arrangement "
            "(spec §9 step 3), e.g. 'Own transcription from …' or 'Original arrangement …'"
        )
    notes = [f"edition: {r}" for r in find(text, _SOFT)]
    return errors, notes
