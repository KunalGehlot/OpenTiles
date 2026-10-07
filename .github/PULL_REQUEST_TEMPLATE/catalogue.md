## Catalogue piece

<!-- Open this template with ?template=catalogue.md on the compare URL. -->

- **Title:**
- **Composer (and lyricist) with death years:**
- **Source of the transcription (link) and licence:**
- **Why this is not a copy of a protected edition:**
- **Suggested difficulty (1–5):**

## Checklist

- [ ] Every creator died in 1955 or earlier (for a 2026 release), or the tune is traditional
- [ ] The transcription is the transcriber's own work under CC0 / public domain / CC BY, and
      `edition_note` says so
- [ ] `provenance.json` has every field; `verified` is `false` (a reviewer sets it)
- [ ] `python3 tools/pipeline/wikidata.py update` has cached the death years (commit
      `catalogue/cache/wikidata.json`)
- [ ] `python3 tools/pipeline/build_index.py` and `validate_catalogue.py` pass
- [ ] Every commit is signed off (`git commit -s`)

## For the reviewer

Follow [catalogue/REVIEWING.md](https://github.com/KunalGehlot/OpenTiles/blob/main/catalogue/REVIEWING.md) (about 10 minutes per piece), then
set `verified: true`, `reviewed_by` and `reviewed_on` in the piece's `provenance.json`.
