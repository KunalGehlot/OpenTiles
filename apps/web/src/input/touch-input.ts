// The on-screen keyboard and the computer keyboard (for trying the app with no instrument).
import type { InputAdapter, NoteEvent } from '@opentiles/practice';
import { now } from '../audio/context';

/** Physical key positions (KeyboardEvent.code) → semitones above the base C, like a piano. */
export const KEY_MAP: Readonly<Record<string, number>> = {
  KeyA: 0,
  KeyW: 1,
  KeyS: 2,
  KeyE: 3,
  KeyD: 4,
  KeyF: 5,
  KeyT: 6,
  KeyG: 7,
  KeyY: 8,
  KeyH: 9,
  KeyU: 10,
  KeyJ: 11,
  KeyK: 12,
  KeyO: 13,
  KeyL: 14,
  KeyP: 15,
  Semicolon: 16,
};

export class TouchInput implements InputAdapter {
  readonly source = 'touch' as const;
  onNote: (event: NoteEvent) => void = () => {};
  onRelease: (pitch: number, time: number) => void = () => {};
  /** MIDI pitch of the C that the A key plays. */
  base = 60;
  private down = new Set<string>();

  async start(): Promise<void> {
    window.addEventListener('keydown', this.keydown);
    window.addEventListener('keyup', this.keyup);
  }

  stop(): void {
    window.removeEventListener('keydown', this.keydown);
    window.removeEventListener('keyup', this.keyup);
  }

  press(pitch: number): void {
    this.onNote({ pitch, time: now(), velocity: 90, confidence: 1, source: 'touch' });
  }

  release(pitch: number): void {
    this.onRelease(pitch, now());
  }

  private keydown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    if (
      target?.closest('input, textarea, select, [contenteditable]') ||
      e.metaKey ||
      e.ctrlKey ||
      e.altKey
    ) {
      return;
    }
    if (e.code === 'KeyZ') {
      this.base = Math.max(24, this.base - 12);
      return;
    }
    if (e.code === 'KeyX') {
      this.base = Math.min(96, this.base + 12);
      return;
    }
    const offset = KEY_MAP[e.code];
    if (offset === undefined || e.repeat || this.down.has(e.code)) return;
    e.preventDefault();
    this.down.add(e.code);
    this.press(this.base + offset);
  };

  private keyup = (e: KeyboardEvent) => {
    const offset = KEY_MAP[e.code];
    if (offset === undefined) return;
    this.down.delete(e.code);
    this.release(this.base + offset);
  };
}
