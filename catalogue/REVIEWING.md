# Reviewing a catalogue piece

Every piece needs one human review before it is shown in production builds (spec §9, step 6).
A review takes about **10 minutes**. You do not need to be a lawyer or a concert pianist: you
check that the paperwork is complete, that the music sounds right and that nothing was copied
from a protected edition. If anything is unclear, leave a comment on the pull request and do
**not** verify the piece.

Rules for reviewers:

- Review only pieces you did not add or arrange yourself.
- Never paste a third-party score, recording or scan into the pull request. Use outside sources
  only to compare.
- One pull request may verify several pieces, but each piece gets its own pass through this list.

## Before you start (1 minute)

1. Check out the pull request and run the checks:

   ```sh
   python3 tools/pipeline/validate_catalogue.py
   ```

   It must end with `0 with problems`. Read every `note:` line for the piece: the validator
   prints them when it cannot settle something on its own (for example an ambiguous Wikidata
   match or an IMSLP mention).

2. Open `catalogue/pieces/<slug>/provenance.json` next to this list.

## 1. Rights (3 minutes)

- [ ] **Composer.** The death year in `composer_death_year` is **1955 or earlier** for a 2026
      release (release year minus 71). The validator compares it with Wikidata through the
      committed cache. When it reports the name as ambiguous or not found, look the person up on
      [Wikidata](https://www.wikidata.org), check the year and set `composer_wikidata` to the
      item ID (for example `Q255` for Ludwig van Beethoven). Then run
      `python3 tools/pipeline/wikidata.py update` and commit `catalogue/cache/wikidata.json`.
- [ ] **Traditional tunes.** `traditional: true` only for genuinely anonymous melodies. Search
      the title once: some tunes called "traditional" have a known modern composer, and then
      that composer's death year applies.
- [ ] **Lyrics.** If the score contains lyrics, the lyricist also died in 1955 or earlier
      (`lyricist`, `lyricist_death_year`). Otherwise the lyrics must be removed.
- [ ] **Licence.** `source_licence` is CC0, public domain or CC BY, and CC BY pieces have an
      `attribution` line. A PDMX file must come from the `no_license_conflict` subset with a CC0
      dedication (`tools/pipeline/pdmx_filter.py` records this).
- [ ] **Edition (§§ 70/71 UrhG).** `edition_note` says the score is the transcriber's own
      transcription or arrangement. It is not a scan or music-OCR output, and not copied from an
      Urtext, scholarly or first edition. If the PDMX filter marked the file "review", each
      reason it gave has been checked.

## 2. Music (4 minutes)

- [ ] **Listen.** Start the app (`pnpm dev`), open the piece from the catalogue and play it in
      listen mode at 100 % tempo.
- [ ] **Notes and rhythm.** Compare with a public-domain reference: for folk tunes and carols a
      melody you know well, for classical works an old public-domain edition (for example on
      IMSLP). Look for wrong notes, missing accidentals, wrong rhythms, and the right key and
      time signature. A simplified arrangement may leave notes out but must not change the
      tune.
- [ ] **Hands.** The right hand is on the upper staff and the left hand on the lower one, both
      hands have notes (or `single_hand` says which hand plays), and nothing needs a stretch
      wider than an octave below difficulty 4.
- [ ] **Fingering and tempo.** Fingering numbers, if any, are playable; the tempo suits the
      piece.

## 3. Metadata (1 minute)

- [ ] The title is the usual English title (or the original title with the English one in
      brackets), in British spelling.
- [ ] The composer is spelt as on Wikidata.
- [ ] The difficulty fits the scale below.

| Level | Label in the app | What it looks like                                                             |
| ----- | ---------------- | ------------------------------------------------------------------------------ |
| 1     | First steps      | One hand position, quarter, half and whole notes, left hand holds single notes |
| 2     | Beginner         | Small position shifts, dotted rhythms and eighths, simple left-hand changes    |
| 3     | Elementary       | Both hands move, sixteenths or 6/8 figures, accidentals, left-hand patterns    |
| 4     | Intermediate     | Independent hands, chords in both hands, faster passages                       |
| 5     | Advanced         | Concert repertoire                                                             |

## 4. Sign off (1 minute)

If everything above is ticked:

1. In `provenance.json` set `"verified": true`, `"reviewed_by": "<your GitHub handle>"` and
   `"reviewed_on": "<today, YYYY-MM-DD>"`.
2. Rebuild the index and run the checks again:

   ```sh
   python3 tools/pipeline/build_index.py
   python3 tools/pipeline/validate_catalogue.py
   ```

3. Commit with a sign-off (`git commit -s`) and mention the piece in the pull request.

If something is wrong, request changes and say what. Reject the piece outright when the
composer or lyricist is still protected, when the source is a scan, OCR output or a copied
edition, or when no one can say where the notes came from.
