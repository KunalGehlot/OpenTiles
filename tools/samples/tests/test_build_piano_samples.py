"""Tests for the piano sample build. Run: python3 -m unittest discover -s tools/samples/tests"""

from __future__ import annotations

import array
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import build_piano_samples as b  # noqa: E402


def plan(loudness: float) -> b.Plan:
    return b.Plan(
        pitch=60,
        src=Path("x.wav"),
        rate=44100,
        start=0,
        length=1,
        truncated=False,
        peak=1,
        loudness=loudness,
    )


class NamesTest(unittest.TestCase):
    def test_pitches_every_minor_third(self) -> None:
        p = b.pitches()
        self.assertEqual(len(p), 30)
        self.assertEqual((p[0], p[-1]), (21, 108))

    def test_names_match_release_and_web_app(self) -> None:
        self.assertEqual(b.pitch_name(21, b.RELEASE_NAMES), "A0")
        self.assertEqual(b.pitch_name(27, b.RELEASE_NAMES), "D#1")
        self.assertEqual(b.pitch_name(27, b.NAMES), "Ds1")
        self.assertEqual(b.pitch_name(108, b.NAMES), "C8")


class OnsetTest(unittest.TestCase):
    def test_finds_first_sample_at_one_percent_of_peak(self) -> None:
        signal = array.array("h", [0] * 50 + [5] * 10 + [10000] * 100)
        # Peak 10000, so the quiet run of 5s before it is below the 1% threshold.
        self.assertEqual(b.onset(signal, 1000), 60)

    def test_silence_is_onset_zero(self) -> None:
        self.assertEqual(b.onset(array.array("h", [0] * 10), 1000), 0)


class SmoothTest(unittest.TestCase):
    def test_moves_outliers_towards_neighbours(self) -> None:
        plans = [plan(x) for x in [-20.0, -21.0, -12.0, -21.0, -20.0]]
        b.smooth(plans)
        self.assertAlmostEqual(plans[2].correction, -6.0)  # 8 dB too loud, clamped to 6
        self.assertAlmostEqual(plans[0].correction, 0.0)  # median of -20, -21, -12
        self.assertAlmostEqual(plans[1].correction, 0.5)  # median of four: -20.5

    def test_leaves_an_even_set_alone(self) -> None:
        plans = [plan(-20.0 - i * 0.1) for i in range(7)]
        b.smooth(plans)
        for p in plans[2:-2]:
            self.assertAlmostEqual(p.correction, 0.0)


if __name__ == "__main__":
    unittest.main()
