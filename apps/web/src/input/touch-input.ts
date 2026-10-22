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
  /**
   * Something a key must wait for before it plays (sound starting on this device), or null to play
   * at once. The key's release waits with it.
   */
  waitFor: () => Promise<unknown> | null = () => null;
  private down = new Set<string>();
  /** Keys and releases held back while waiting, in the order they happened. */
  private queue: Promise<void> | null = null;

  async start(): Promise<void> {
    window.addEventListener('keydown', this.keydown);
    window.addEventListener('keyup', this.keyup);
  }

  stop(): void {
    window.removeEventListener('keydown', this.keydown);
    window.removeEventListener('keyup', this.keyup);
  }

  press(pitch: number): void {
    const play = () =>
      this.onNote({ pitch, time: now(), velocity: 90, confidence: 1, source: 'touch' });
    const wait = this.queue ?? this.waitFor();
    if (wait) this.after(wait, play);
    else play();
  }

  release(pitch: number): void {
    const play = () => this.onRelease(pitch, now());
    if (this.queue) this.after(this.queue, play);
    else play();
  }

  /** Runs `fn` once `wait` has settled, after everything held back before it. */
  private after(wait: Promise<unknown>, fn: () => void): void {
    const next = wait.catch(() => {}).then(fn);
    this.queue = next;
    void next.then(() => {
      if (this.queue === next) this.queue = null;
    });
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
