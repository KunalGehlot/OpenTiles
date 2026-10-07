// The metronome's own output (PLAN.md P1-13): the same oscillator click as the count-in, through
// a gain the practice bar controls, so the click can be turned down without touching the piano.
import { playClick } from './instrument';

export class ClickTrack {
  private readonly out: GainNode;

  constructor(private readonly ctx: BaseAudioContext) {
    this.out = ctx.createGain();
    this.out.gain.value = 0.5;
    this.out.connect(ctx.destination);
  }

  /** 0–1. */
  get volume(): number {
    return this.out.gain.value;
  }

  set volume(v: number) {
    this.out.gain.value = Math.max(0, Math.min(1, v));
  }

  click(when: number, accent = false): void {
    playClick(this.ctx, this.out, when, accent);
  }
}

const tracks = new WeakMap<BaseAudioContext, ClickTrack>();

/** The click track for an unlocked audio context (create the context from a user gesture). */
export function clickTrackFor(ctx: BaseAudioContext): ClickTrack {
  let t = tracks.get(ctx);
  if (!t) {
    t = new ClickTrack(ctx);
    tracks.set(ctx, t);
  }
  return t;
}
