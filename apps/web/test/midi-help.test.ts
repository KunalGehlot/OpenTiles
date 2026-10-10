import { describe, expect, it } from 'vitest';
import {
  describeMidiError,
  midiUnavailableMessage,
  midiUnavailableReason,
} from '../src/input/midi-input';

const SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15';
const IPAD_DESKTOP_MODE = SAFARI;
const CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const FIREFOX =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:145.0) Gecko/20100101 Firefox/145.0';

describe('MIDI help', () => {
  it('names the reason a browser has no MIDI', () => {
    expect(midiUnavailableReason({ userAgent: SAFARI, maxTouchPoints: 0, secure: true })).toBe(
      'safari',
    );
    // iPadOS Safari reports itself as a Mac with touch points.
    expect(
      midiUnavailableReason({ userAgent: IPAD_DESKTOP_MODE, maxTouchPoints: 5, secure: true }),
    ).toBe('apple-mobile');
    expect(midiUnavailableReason({ userAgent: FIREFOX, maxTouchPoints: 0, secure: false })).toBe(
      'insecure',
    );
    expect(midiUnavailableReason({ userAgent: CHROME, maxTouchPoints: 0, secure: true })).toBe(
      'other',
    );
    expect(midiUnavailableMessage('safari')).toMatch(/Chrome, Edge or Firefox/);
  });

  it('explains Firefox’s add-on prompt when MIDI is refused there', () => {
    const refused = new DOMException('WebMIDI requires a site permission add-on', 'SecurityError');
    expect(describeMidiError(refused, FIREFOX)).toMatch(/site permission/);
    expect(describeMidiError(refused, CHROME)).toMatch(/Allow MIDI devices/);
    expect(describeMidiError(new Error('boom'), CHROME)).toBe('boom');
  });
});
