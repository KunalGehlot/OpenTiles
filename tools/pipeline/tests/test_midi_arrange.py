"""Tests for midi_arrange.py with MIDI files built in code (CC0)."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import arrange  # noqa: E402
import midi_arrange as ma  # noqa: E402

PPQ = 96


def vlq(n: int) -> bytes:
    out = [n & 0x7F]
    n >>= 7
    while n:
        out.append((n & 0x7F) | 0x80)
        n >>= 7
    return bytes(reversed(out))


def track(events: list[tuple[int, bytes]]) -> bytes:
    body = b""
    last = 0
    for tick, data in sorted(events, key=lambda e: e[0]):
        body += vlq(tick - last) + data
        last = tick
    body += b"\x00\xff\x2f\x00"
    return b"MTrk" + len(body).to_bytes(4, "big") + body


def note(start: int, length: int, pitch: int) -> list[tuple[int, bytes]]:
    return [(start, bytes([0x90, pitch, 80])), (start + length, bytes([0x80, pitch, 0]))]


def midi(tracks: list[list[tuple[int, bytes]]], fifths: int = 0, numerator: int = 4) -> bytes:
    meta = [
        (0, b"\xff\x58\x04" + bytes([numerator, 2, 24, 8])),
        (0, b"\xff\x59\x02" + bytes([fifths & 0xFF, 0])),
        (0, b"\xff\x51\x03" + (500_000).to_bytes(3, "big")),
    ]
    head = b"MThd" + (6).to_bytes(4, "big") + (1).to_bytes(2, "big") + (len(tracks) + 1).to_bytes(2, "big") + PPQ.to_bytes(2, "big")
    return head + track(meta) + b"".join(track(t) for t in tracks)


def two_bars() -> bytes:
    rh = []
    for i, p in enumerate([72, 74, 76, 77, 79, 77, 76, 74]):
        rh += note(i * PPQ, PPQ, p)
    lh = note(0, 4 * PPQ, 48) + note(4 * PPQ, 4 * PPQ, 43)
    return midi([rh, lh])


class ParseTests(unittest.TestCase):
    def test_reads_notes_tempo_and_signatures(self):
        m = ma.parse_midi(two_bars())
        self.assertEqual(m.ppq, PPQ)
        self.assertEqual(len(m.notes), 10)
        self.assertEqual(m.time_signature, (4, 4))
        self.assertAlmostEqual(m.tempos[0][1], 120)

    def test_rejects_garbage(self):
        with self.assertRaises(ma.MidiError):
            ma.parse_midi(b"nope")
        with self.assertRaises(ma.MidiError):
            ma.parse_midi(midi([[]]))


class BuildTests(unittest.TestCase):
    def test_two_hands_become_bars_that_arrange_py_accepts(self):
        text = ma.build(ma.parse_midi(two_bars()), "Test", "Nobody", 100)
        self.assertIn("RH: C5q D5q E5q F5q | G5q F5q E5q D5q", text)
        self.assertIn("LH: C3w | G2w", text)
        self.assertIn("<score-partwise", arrange.to_musicxml(arrange.parse(text)))

    def test_flat_keys_use_flats(self):
        self.assertEqual(ma.spell(70, -2), "Bb4")
        self.assertEqual(ma.spell(70, 2), "A#4")
        self.assertEqual(ma.spell(60, 0), "C4")

    def test_durations_split_into_notes_and_rests(self):
        # Five sixteenths: a quarter, then a sixteenth rest.
        self.assertEqual([t[1:] for t in ma.duration_tokens(5)], [("q", ""), ("s", "")])
        self.assertEqual([t[1:] for t in ma.duration_tokens(6)], [("q", ".")])

    def test_notes_that_start_together_make_a_chord(self):
        rh = note(0, 4 * PPQ, 60) + note(0, 4 * PPQ, 64) + note(0, 4 * PPQ, 67)
        text = ma.build(ma.parse_midi(midi([rh, note(0, 4 * PPQ, 36)])), "Chord", "Nobody", 80)
        self.assertIn("[C4 E4 G4]w", text)

    def test_a_note_is_cut_at_the_next_onset(self):
        rh = note(0, 4 * PPQ, 60) + note(PPQ, PPQ, 62)
        text = ma.build(ma.parse_midi(midi([rh, note(0, 4 * PPQ, 36)])), "Cut", "Nobody", 80)
        self.assertIn("C4q D4q", text.split("RH: ")[1])

    def test_triplets_are_refused_and_grace_notes_dropped(self):
        third = PPQ // 3
        triplets = []
        for i in range(12):
            triplets += note(i * third, third, 60 + i % 3)
        with self.assertRaises(ma.MidiError):
            ma.build(ma.parse_midi(midi([triplets, note(0, 4 * PPQ, 36)])), "T", "N", 80)
        grace = note(PPQ - 5, 5, 61) + note(PPQ, PPQ, 62) + note(0, PPQ, 60) + note(2 * PPQ, 2 * PPQ, 64)
        text = ma.build(ma.parse_midi(midi([grace, note(0, 4 * PPQ, 36)])), "G", "N", 80)
        self.assertNotIn("C#4", text)

    def test_a_pickup_is_given_by_the_caller_not_guessed(self):
        rh = note(0, PPQ, 67) + note(PPQ, 4 * PPQ, 72)
        data = ma.parse_midi(midi([rh, note(PPQ, 4 * PPQ, 48)]))
        self.assertIn("pickup: yes", ma.build(data, "Up", "N", 80, pickup=4))
        # Without one, the first bar is a full bar and the short end is padded with rests.
        plain = ma.build(data, "Up", "N", 80)
        self.assertNotIn("pickup", plain)
        self.assertIn("arrange", arrange.to_musicxml(arrange.parse(plain)) and "arrange")


if __name__ == "__main__":
    unittest.main()
