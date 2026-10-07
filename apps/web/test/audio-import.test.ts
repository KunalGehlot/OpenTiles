import { describe, expect, it } from 'vitest';
import { isAudioFile } from '../src/lib/audio-import';

describe('isAudioFile', () => {
  it('recognises audio by extension or MIME type', () => {
    expect(isAudioFile('Recording.M4A')).toBe(true);
    expect(isAudioFile('take 2.wav')).toBe(true);
    expect(isAudioFile('voice-memo', 'audio/mp4')).toBe(true);
  });

  it('leaves scores to the score importer', () => {
    expect(isAudioFile('minuet.musicxml')).toBe(false);
    expect(isAudioFile('minuet.mid', 'audio/midi')).toBe(false);
    expect(isAudioFile('minuet.mxl')).toBe(false);
  });
});
