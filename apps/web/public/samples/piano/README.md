# Piano samples

The MP3 files in this folder (30 notes) and in `soft/` and `loud/` (30 notes each) are the piano
sound of OpenTiles. They are adapted from the
**Salamander Grand Piano V3** by **Alexander Holm** (a Yamaha C5 grand piano), licensed under the
[Creative Commons Attribution 3.0 Unported licence](https://creativecommons.org/licenses/by/3.0/)
(CC BY 3.0). The full licence text is in [LICENSE.txt](LICENSE.txt).

These files are not covered by the AGPL that applies to the OpenTiles code. You may reuse them
under CC BY 3.0, crediting Alexander Holm as the author and noting the changes listed below.

## Source

- Release: Salamander Grand Piano V3, Internet Archive item
  [SalamanderGrandPianoV3](https://archive.org/details/SalamanderGrandPianoV3)
  (creator Alexander Holm, dated 2011-08-12, uploaded 2015-02-18).
- File: `SalamanderGrandPianoV3_44.1khz16bit.tar.bz2`, 488,713,261 bytes,
  SHA-1 `ec5a179a1218a590d2f88728f56b583e79876896` (matches the archive's own checksum record).
- Licence statement: the release's `README` and the archive item's metadata both say
  "Licence: CC-by, http://creativecommons.org/licenses/by/3.0/" and "Author: Alexander Holm".
  Downloaded and checked on 2026-10-07.

The files were made from the original release, not from a mirror. The release ships a second
mapping, `SalamanderGrandPianoV3Retuned.sfz` (retuning by Markus Fiedler); it is not used, so the
samples play at their recorded tuning, as in the release's standard mapping.

## What was changed

Made by [`tools/samples/build_piano_samples.py`](../../../../../tools/samples/build_piano_samples.py)
with ffmpeg 6.1.1 and LAME 3.100:

1. Velocity layer 10 of 16 only (`<note>v10.wav`, which the release plays for MIDI velocities
   73–80), one note every minor third from A0 to C8, as the release is sampled.
2. Mixed to mono: (left + right) / 2.
3. Trimmed to start 3 ms before the hammer attack.
4. Cut to at most 8 seconds, fading out over the last 2 seconds; shorter samples (C6 and up) keep
   their full length with a 0.25 s fade at the end.
5. Each sample's level moved towards the median loudness (EBU R128, first 0.5 s) of itself and two
   neighbours on each side, by at most 6 dB, so scales sound even. Corrections, in dB:

   | A0  | C1  | D♯1  | F♯1  | A1  | C2  | D♯2  | F♯2  | A2  | C3  | D♯3  | F♯3 | A3  | C4   | D♯4 |
   | --- | --- | ---- | ---- | --- | --- | ---- | ---- | --- | --- | ---- | --- | --- | ---- | --- |
   | 0.0 | 0.4 | −0.7 | −0.6 | 1.0 | 0.9 | −0.9 | −1.0 | 0.9 | 0.0 | −1.8 | 3.8 | 4.5 | −3.7 | 0.0 |

   | F♯4  | A4  | C5  | D♯5 | F♯5  | A5  | C6  | D♯6  | F♯6 | A6  | C7   | D♯7 | F♯7 | A7   | C8  |
   | ---- | --- | --- | --- | ---- | --- | --- | ---- | --- | --- | ---- | --- | --- | ---- | --- |
   | −1.2 | 0.0 | 4.0 | 0.0 | −2.9 | 0.6 | 0.3 | −0.9 | 0.0 | 1.0 | −1.0 | 1.6 | 0.0 | −1.2 | 3.6 |

6. Overall gain of +8.14 dB, so the loudest sample peaks at −1 dBFS.
7. Encoded as variable-bit-rate MP3 (LAME `-V2`, 44.1 kHz mono, about 63 kbit/s), with ID3 tags
   naming the author and licence. Total size about 1.8 MB.

File names follow the note, with `s` for sharp: `A0.mp3`, `C1.mp3`, `Ds1.mp3`, `Fs1.mp3`, …,
`C8.mp3`. [SHA256SUMS](SHA256SUMS) lists the checksum of each file.

## The softer and louder layers (2026-10-19)

`soft/` and `loud/` hold two more of the release's velocity layers, so that a soft note sounds like
a soft hammer blow and a loud one like a hard one, not just quieter or louder. Made by the same
script, from the same archive (SHA-1 checked), with ffmpeg 9.0.1 and LAME 4.0. The files in this
folder (layer 10) were not rebuilt.

1. `soft/`: velocity layer 5 of 16 (`<note>v5.wav`, which the release plays for velocities 33–40);
   `loud/`: layer 14 (`<note>v14.wav`, velocities 105–112). The same 30 notes.
2. Mixed to mono, trimmed to 3 ms before the attack, as above.
3. Cut to at most 5 seconds for `soft/` (a soft note has faded by then, and it saves memory on an
   iPad) and 8 seconds for `loud/`, with the same fades.
4. Levels evened out between neighbours as above, each layer on its own. Corrections, in dB, for
   `soft/`:

   | A0  | C1   | D♯1 | F♯1  | A1  | C2  | D♯2  | F♯2  | A2  | C3  | D♯3  | F♯3 | A3  | C4   | D♯4 |
   | --- | ---- | --- | ---- | --- | --- | ---- | ---- | --- | --- | ---- | --- | --- | ---- | --- |
   | 0.5 | −0.2 | 0.0 | −0.8 | 1.0 | 0.9 | −1.1 | −0.5 | 0.5 | 0.6 | −2.7 | 4.5 | 5.3 | −3.0 | 0.0 |

   | F♯4  | A4  | C5  | D♯5 | F♯5  | A5  | C6  | D♯6  | F♯6  | A6  | C7  | D♯7 | F♯7  | A7   | C8  |
   | ---- | --- | --- | --- | ---- | --- | --- | ---- | ---- | --- | --- | --- | ---- | ---- | --- |
   | −0.2 | 0.0 | 3.6 | 0.0 | −3.8 | 0.9 | 4.7 | −2.7 | −2.7 | 0.0 | 0.0 | 5.0 | −1.3 | −0.9 | 1.7 |

   and for `loud/`:

   | A0  | C1  | D♯1  | F♯1  | A1  | C2  | D♯2 | F♯2  | A2  | C3  | D♯3  | F♯3 | A3  | C4   | D♯4 |
   | --- | --- | ---- | ---- | --- | --- | --- | ---- | --- | --- | ---- | --- | --- | ---- | --- |
   | 0.0 | 0.1 | −0.1 | −0.6 | 0.2 | 0.7 | 0.0 | −0.2 | 0.0 | 1.1 | −1.5 | 3.4 | 3.2 | −4.8 | 0.0 |

   | F♯4  | A4  | C5  | D♯5  | F♯5  | A5  | C6  | D♯6  | F♯6 | A6  | C7   | D♯7 | F♯7 | A7   | C8  |
   | ---- | --- | --- | ---- | ---- | --- | --- | ---- | --- | --- | ---- | --- | --- | ---- | --- |
   | −2.1 | 0.5 | 3.1 | −0.5 | −2.6 | 0.6 | 0.7 | −1.3 | 0.7 | 1.4 | −4.9 | 1.6 | 3.1 | −4.2 | 0.0 |

5. Overall gain of +11.60 dB for `soft/` and +4.10 dB for `loud/`, so each layer's loudest sample
   peaks at −1 dBFS. The script prints each layer's level (the median loudness of its attacks):
   −15.66 LUFS for layer 10, −16.20 for `soft/` and −16.20 for `loud/`; the app takes the
   difference off when it plays them, so loudness follows the velocity and the layer changes the
   tone.
6. Encoded as above. About 1.2 MB for `soft/` and 1.6 MB for `loud/`; each folder has its own
   `SHA256SUMS`.

## Rebuilding

```sh
curl -LO https://archive.org/download/SalamanderGrandPianoV3/SalamanderGrandPianoV3_44.1khz16bit.tar.bz2
python3 tools/samples/build_piano_samples.py SalamanderGrandPianoV3_44.1khz16bit.tar.bz2 apps/web/public/samples/piano
python3 tools/samples/build_piano_samples.py SalamanderGrandPianoV3_44.1khz16bit.tar.bz2 apps/web/public/samples/piano/soft --layer 5 --max-seconds 5
python3 tools/samples/build_piano_samples.py SalamanderGrandPianoV3_44.1khz16bit.tar.bz2 apps/web/public/samples/piano/loud --layer 14
```

The script checks the archive's SHA-1 before using it. Different ffmpeg or LAME versions produce
slightly different bytes; the sound is the same.
