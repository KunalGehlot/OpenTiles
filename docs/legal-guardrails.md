# Legal guardrails

These rules turn the private-library design into product requirements that the code and the
marketing must keep (spec §2, §10). The operator's jurisdiction is Germany. This is not legal
advice; a German copyright lawyer reviews the final design before public launch (P2-18).

Reviewers: a pull request that breaks one of these rules is blocked, however useful the feature.

## Product rules

- [x] **No distribution path exists in the code.** There is no share link, export-to-public or
      "publish" button for library items. The only export is the user's own encrypted backup.
      _(Enforced by review; ESLint blocks `navigator.share` as a tripwire.)_
- [ ] **The operator cannot see library contents.** Sync blobs, file names and titles are end-to-end
      encrypted (P3-03), so there is nothing for the operator to select, curate or promote.
- [x] **No copyrighted titles in marketing.** Screenshots, demo videos, docs, test fixtures and the
      README use public-domain or self-made CC0 pieces only.
- [x] **No import tools aimed at other sites.** Imports take local files only; no URL import from
      score-sharing sites or video platforms.
- [ ] **Upload terms.** Before the first import, users confirm they only import files they have the
      right to use for personal practice.
- [ ] **Notice-and-takedown contact.** Published in the Impressum (P2-17).
- [x] **Catalogue provenance.** Every public piece records its source, licence, creator death years
      and the transcriber/arranger; CI rejects incomplete records (P2-01a).
- [ ] **Legal review before public launch** (P2-18).

## Catalogue rules

- Keep only works whose creators (composer, and lyricist when there are lyrics) died at least 70
  full calendar years before the release year — for a 2026 release, death in 1955 or earlier — plus
  traditional or anonymous tunes. Drop lyrics when the lyricist cannot be verified.
- Scholarly and first editions have their own protection in Germany (§§ 70/71 UrhG). Only use files
  that are a transcriber's own work released as CC0 (or public domain / CC BY), never scans or
  copies of a publisher's edition.
- PDMX entries only from the `no_license_conflict` subset.
- Takedown requests are handled within 48 hours: remove the piece, then investigate.

## Data protection

- [ ] Sync storage hosted in the EU (P3-03).
- [ ] Privacy policy describing exactly the data in spec §10; no tracking cookies, so no cookie
      banner (P2-17).
- [x] No analytics by default. Optional anonymous crash reports are opt-in (P3-08).
- [ ] Impressum with the operator's contact details, including the notice-and-takedown address
      (P2-17).
- [ ] Records of processing kept, even if minimal (P2-17).

## What this means when you write code

- Don't add `fetch` calls that carry library data, titles or file names anywhere.
- Don't add third-party scripts, fonts or images loaded at runtime from other origins.
- Don't add a "share", "send to" or "publish" affordance to library items, even "just for links".
- Don't add a field that would let the operator learn which pieces a user owns.
- Do keep the upload-rights confirmation in the import flow.
