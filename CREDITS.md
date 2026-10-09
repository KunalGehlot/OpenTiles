# Credits

## How OpenTiles was made

OpenTiles was written with a large language model (LLM) working under the maintainer's direction.
The maintainer reviews the work and is responsible for what ships; contributors sign off their
commits under the [Developer Certificate of Origin](https://developercertificate.org/).

## What came first: Sightread

[Sightread](https://github.com/sightread/sightread) is a free, open-source piano-learning web app
(GPL-3.0, by samouri and contributors, first published in April 2021). OpenTiles looks and works a
lot like it. LLMs learn from public code, so the model used here may have seen Sightread and
similar projects; we cannot rule that out, and we think you should know.

What we checked, on 2026-10-09: we compared Sightread's source tree with `apps/web` and the
TypeScript packages of OpenTiles (normalised four-line windows, identifiers, colours, class names).
We found no shared code. We use none of Sightread's songs, images, sounds or fonts. What the two
share is the idea: falling notes over a keyboard, colour for each hand, and a mode that waits for
the right note, which many piano-learning apps have.

Licence: Sightread is GPL-3.0 and OpenTiles is AGPL-3.0-or-later. GPLv3 §13 and AGPLv3 §13 allow
the two to be combined, so a future contribution that does adapt Sightread code would be possible
if it keeps Sightread's copyright and licence notices. Nothing has been taken so far. Features
that were inspired by Sightread are written from a description of what they do, not from its code.

Please look at Sightread, and if it helps you, support it.

## Third-party material

The piano sound, the score engraver and the other libraries and sources the app ships with are
named, with their licences, on the About page of the app and in `apps/web/public/samples/piano/`.
