// The practice controller: song + mode + inputs → state the canvas draws each frame. Plain
// TypeScript, so timing-critical work never waits for React (docs/development.md).
import {
  accompanimentBetween,
  asPlayed,
  buildSteps,
  holdOverdueAfter,
  judgeHold,
  LiveTally,
  LoopTrainer,
  loopBeats,
  metronomeClicks,
  normaliseLoop,
  PerformanceRecorder,
  PlayAlongScorer,
  polished,
  pulseAt,
  summarise,
  Timeline,
  WaitMode,
} from '@opentiles/practice';
import type {
  HandFilter,
  HoldJudgement,
  InputSource,
  Judgement,
  LiveStats,
  LoopRange,
  LoopRunOutcome,
  NoteEvent,
  PlayedNote,
  RenderNote,
  RunSummary,
  Step,
  TimedNote,
  TimedNoteWithLength,
} from '@opentiles/practice';
import { TempoMap } from '@opentiles/song-model';
import type { Hand, Song, SongNote } from '@opentiles/song-model';
import type { PianoSynth } from '../audio/synth';
import type { Instrument, Voice } from '../audio/instrument';

export type PracticeMode = 'wait' | 'listen' | 'play-along';

export type KeyState = 'held' | 'correct' | 'wrong';

export interface Flash {
  pitch: number;
  kind: 'correct' | 'wrong' | 'missed' | 'early' | 'late';
  until: number;
}

/**
 * A live label drawn above a key: "early" / "late" in play-along (P1-24), "hold longer" /
 * "let go" when a note was held too short or too long (P4-09).
 */
export interface TimingLabel {
  pitch: number;
  kind: 'early' | 'late' | 'short' | 'long';
  /** Played minus expected, ms (early and late only). */
  offsetMs: number;
  until: number;
}

/**
 * A note being held, for the draining hold bar above its key and the hold feedback (P4-09). Only
 * inputs that report key release make one: the microphone cannot see when a key comes up.
 */
export interface Hold {
  pitch: number;
  noteId: string;
  hand: Hand;
  /** Key down, practice clock (s). */
  start: number;
  /** Written length at the practice tempo (s). */
  length: number;
  /** Key up, once released. */
  end?: number;
  /** Set on release, when held long enough (wait mode) or too long (play-along). */
  judgement?: HoldJudgement;
}

export interface HoldStats {
  good: number;
  short: number;
  long: number;
}

/**
 * What one finished run needs for playback as played or polished (P4-09). The keys themselves
 * stay in the recorder, which still takes the key-up of the last note after the run ends.
 */
export interface RunRecording {
  mode: PracticeMode;
  /** The practised notes, timed like the recorded keys (play-along) or from 0 (wait mode). */
  expected: TimedNoteWithLength[];
  /** The other hand when it was played along, timed like `expected`. */
  accompaniment: RenderNote[];
}

/** One finished run of a looped section (P2-08). */
export interface LoopRunReport extends LoopRunOutcome {
  mode: PracticeMode;
  accuracy: number;
  wrong: number;
  missed: number;
  /** The tempo the run was played at. */
  playedTempo: number;
  seconds: number;
}

/**
 * A clock for drawing. `AudioContext.currentTime` advances in steps of a whole audio buffer (several
 * milliseconds, more on Bluetooth and Safari), so a frame that reads it sees uneven jumps and the
 * falling notes judder. This one runs on the display's own timer and is nudged toward the audio
 * clock, so it never drifts from the sound but never steps either.
 */
export function steadyClock(
  real: () => number,
  perf: () => number = () => performance.now() / 1000,
): () => number {
  let anchorReal = 0;
  let anchorPerf = 0;
  let last = -Infinity;
  let ready = false;
  return () => {
    const r = real();
    const p = perf();
    if (!ready) {
      anchorReal = r;
      anchorPerf = p;
      ready = true;
    }
    const predicted = anchorReal + (p - anchorPerf);
    const error = r - predicted;
    if (Math.abs(error) > 0.08) {
      anchorReal = r;
      anchorPerf = p;
      last = r;
      return r;
    }
    anchorReal += error * 0.04;
    last = Math.max(last, anchorReal + (p - anchorPerf));
    return last;
  };
}

/** Plays a metronome click at `when` on the audio clock. */
export type ClickOutput = (when: number, accent: boolean) => void;

export interface SessionStatus {
  mode: PracticeMode;
  playing: boolean;
  finished: boolean;
  stepIndex: number;
  stepCount: number;
  correct: number;
  wrong: number;
  summary: RunSummary | null;
  elapsed: number;
  loop: LoopRange | null;
  metronome: boolean;
  holds: HoldStats;
  /** True once a finished run has something to play back. */
  recorded: boolean;
  /** Perfect, good, missed and wrong notes and the streak, for the live stats strip (P5-07). */
  live: LiveStats;
}

const LEAD_IN = 1.5;
const SCHEDULE_AHEAD = 0.3;
/** Pause between the end of a looped section and its next run in wait mode (seconds). */
const LOOP_PAUSE = 0.6;
/** Seconds after a run ends before the display goes back to the start. */
const HOME_AFTER_SECONDS = 1.2;

/**
 * How long the glide back to the start takes: longer for a longer way back, but never so long that
 * the learner waits for it (seconds).
 */
export function homeSeconds(beats: number): number {
  return Math.min(1.4, 0.6 + 0.008 * Math.abs(beats));
}

/** Slow out of the end, steady through the middle, slow into the start: as a hand would drag it. */
function easeInOut(k: number): number {
  return 0.5 - 0.5 * Math.cos(Math.PI * k);
}

/** How long a judged hold bar stays on screen after it ends (seconds). */
const HOLD_FADE = 0.4;

export class PracticeSession {
  readonly tempoMap: TempoMap;
  private songValue: Song;
  mode: PracticeMode = 'wait';
  hands: HandFilter = 'both';
  tempo = 1;
  accompany = true;
  /** Play a sound for notes from inputs that make none themselves (touch). */
  soundForTouch = true;
  /**
   * How much the screen gives away (P5-05): falling notes and the keys to press (`full`), the keys
   * only (`keys`), or nothing but the score (`none`, for sight-reading drills).
   */
  guide: 'full' | 'keys' | 'none' = 'full';
  /**
   * Plays the notes of a MIDI keyboard on this device too (Settings → MIDI keyboard), for keyboards
   * with no speakers or for headphones on the computer. Null: the keyboard's own sound only.
   */
  midiEcho: Instrument | null = null;
  private echoVoices = new Map<number, Voice>();

  steps: Step[] = [];
  wait: WaitMode;
  /** Beat shown at the now-line. */
  beat = 0;
  readonly keys = new Map<number, KeyState>();
  flashes: Flash[] = [];
  /**
   * When each key was last struck (clock time): by the learner, or by the piece itself in listen
   * and play-along. The keyboard dips the key for a moment, so a repeated note shows as a new press
   * even while the key stays lit.
   */
  readonly strikes = new Map<number, number>();
  /** Glide back to the start after a run instead of jumping there (off under Reduce motion). */
  glideHome = true;
  /** Note ids already played correctly in this run (drawn differently). */
  readonly done = new Set<string>();
  /** Play-along judgements of this run by note id, for live colours (P1-24). */
  readonly judged = new Map<string, Judgement>();
  labels: TimingLabel[] = [];
  /** Metronome during listen and play-along, and a steady click in wait mode (P1-13). */
  metronome = false;
  /** Measured input latency per source, seconds (P1-19, P1-20). */
  latency: Partial<Record<InputSource, number>> = {};
  /** The looped bars, if any (P2-08). */
  loop: LoopRange | null = null;
  readonly loopTrainer = new LoopTrainer();
  /**
   * Per-note feedback for the score views: `wrong` when a wrong key was played while the note was
   * expected (wait mode) or the note was missed (play-along); it stays red for the rest of the run.
   */
  readonly marks = new Map<string, 'correct' | 'wrong'>();
  /** Notes being held (and judged holds fading out), by pitch (P4-09). */
  readonly holds = new Map<number, Hold>();
  holdStats: HoldStats = { good: 0, short: 0, long: 0 };
  /** Every key of the current run, down and up (P4-09). */
  readonly recorder = new PerformanceRecorder();
  /** The last finished run, for playback; null until one finishes. */
  recording: RunRecording | null = null;
  private readonly tally = new LiveTally();
  /** A wrong key was played while the current wait-mode step was expected. */
  private stepHadWrong = false;
  /** Clock time of the last note from any input; 0 before the first (keeps the screen on, P5-02). */
  lastInputAt = 0;

  private timeline: Timeline | null = null;
  private scorer: PlayAlongScorer | null = null;
  private schedule: { note: SongNote; time: number }[] = [];
  private scheduled = 0;
  private startedAt = 0;
  private finishedAt = 0;
  /** After a run the display went back to the start (the notes, cursor and score all follow `beat`). */
  private homed = false;
  /**
   * The glide back to the start after a run, as dragging the score there would look: `beat` moves,
   * and the score, the cursor and the falling notes follow it. Null when not gliding.
   */
  private homing: { from: number; to: number; at: number; seconds: number } | null = null;
  /** Start times of the notes in the learner's hands for this listen or play-along run, in order. */
  private cues: { pitch: number; time: number }[] = [];
  private cued = 0;
  /**
   * True while the learner drags the score (P4-18): the position follows the drag exactly, and wait
   * mode does not pull it to its step until the drag ends.
   */
  scrubbing = false;
  private summary: RunSummary | null = null;
  private lastStatus = '';
  private endBeat = 0;
  private clickOut: ClickOutput | null = null;
  private clicks: { time: number; accent: boolean }[] = [];
  private clicked = 0;
  private waitClick: { next: number; count: number } | null = null;
  private loopRestartAt = 0;
  private runStartedAt = 0;
  private readonly loopListeners = new Set<(r: LoopRunReport) => void>();

  /** UI listeners: called when something the controls show has changed. */
  onStatus: (s: SessionStatus) => void = () => {};
  /** Called with the pitches the microphone should listen for. */
  onExpected: (pitches: number[]) => void = () => {};
  /** Called when a run ends with its summary. */
  onFinish: (s: RunSummary, seconds: number) => void = () => {};
  /** Called when the session changes the tempo itself (automatic loop speed-up). */
  onTempo: (factor: number) => void = () => {};

  private lastFramePerf = 0;
  private readonly display: () => number;

  constructor(
    song: Song,
    private readonly clock: () => number,
    private synth: PianoSynth | null = null,
  ) {
    this.songValue = song;
    this.display = steadyClock(clock);
    this.tempoMap = new TempoMap(song.tempos);
    this.wait = new WaitMode([]);
    this.rebuild();
  }

  get song(): Song {
    return this.songValue;
  }

  /**
   * Swaps in the same piece with other pitches or fingers: fitted to the learner's keyboard
   * (P4-07) or with suggested fingering (P4-08). Bars and tempos must be unchanged; the run
   * restarts.
   */
  setSong(song: Song): void {
    if (song === this.songValue) return;
    this.songValue = song;
    this.rebuild();
  }

  /** What the session plays through: this device, the MIDI keyboard or both (Settings). */
  get instrument(): Instrument | null {
    return this.synth;
  }

  setSynth(s: PianoSynth | null): void {
    this.synth = s;
  }

  /** Where metronome and count-in clicks go; the piano's own click when unset. */
  setClickOutput(out: ClickOutput | null): void {
    this.clickOut = out;
  }

  /** Subscribes to finished loop runs; returns the unsubscribe function. */
  addLoopListener(fn: (r: LoopRunReport) => void): () => void {
    this.loopListeners.add(fn);
    return () => {
      this.loopListeners.delete(fn);
    };
  }

  private click(when: number, accent: boolean): void {
    if (this.clickOut) this.clickOut(when, accent);
    else this.synth?.click(when, accent);
  }

  /** True from the moment a run finishes until the next one starts or the piece is rebuilt. */
  get runEnded(): boolean {
    return this.finishedAt > 0;
  }

  /** After a run, once the position has started back to the start (gliding or there already). */
  get returning(): boolean {
    return this.finishedAt > 0 && this.homed;
  }

  /** Where a run starts and where the position goes back to after one. */
  get homeBeat(): number {
    return this.loopSpan?.fromBeat ?? this.steps[0]?.beat ?? 0;
  }

  get playing(): boolean {
    return this.timeline !== null;
  }

  status(): SessionStatus {
    const stats = this.wait.stats;
    const judged = this.scorer?.results ?? [];
    return {
      mode: this.mode,
      playing: this.playing,
      finished:
        this.loop === null && (this.mode === 'wait' ? this.wait.finished : this.summary !== null),
      stepIndex: this.wait.index,
      stepCount: this.steps.length,
      correct:
        this.mode === 'wait'
          ? stats.correct
          : judged.filter((r) => r.judgement !== 'missed').length,
      wrong: this.mode === 'wait' ? stats.wrong : (this.scorer?.extras.length ?? 0),
      summary: this.summary,
      elapsed: this.startedAt ? (this.finishedAt || this.clock()) - this.startedAt : 0,
      loop: this.loop,
      metronome: this.metronome,
      holds: { ...this.holdStats },
      recorded: this.recording !== null && this.recorder.notes.length > 0,
      live: { ...this.tally.stats },
    };
  }

  private emitStatus(): void {
    const s = this.status();
    const key = JSON.stringify({ ...s, elapsed: Math.floor(s.elapsed) });
    if (key !== this.lastStatus) {
      this.lastStatus = key;
      this.onStatus(s);
    }
  }

  /** Rebuilds steps for the current hands and loop and restarts from the beginning. */
  rebuild(): void {
    this.stop();
    const span = this.loopSpan;
    this.steps = buildSteps(this.song, this.hands, span ?? {});
    this.wait = new WaitMode(this.steps);
    this.wait.onStep = (step) => this.onStep(step);
    this.done.clear();
    this.judged.clear();
    this.labels = [];
    this.marks.clear();
    this.flashes = [];
    this.strikes.clear();
    this.resetRun();
    this.tally.reset();
    this.stepHadWrong = false;
    this.summary = null;
    this.startedAt = 0;
    this.finishedAt = 0;
    this.homed = false;
    this.homing = null;
    this.runStartedAt = 0;
    this.loopRestartAt = 0;
    this.waitClick = null;
    this.beat = this.steps[0]?.beat ?? span?.fromBeat ?? 0;
    this.onExpected(this.steps[0]?.pitches ?? []);
    this.emitStatus();
  }

  setMode(mode: PracticeMode): void {
    this.mode = mode;
    this.rebuild();
  }

  setHands(hands: HandFilter): void {
    this.hands = hands;
    this.rebuild();
  }

  setTempo(factor: number): void {
    this.tempo = factor;
    this.waitClick = null;
    if (this.playing) this.start();
  }

  /** Loops a range of bars, or goes back to the whole piece with `null`. */
  setLoop(range: LoopRange | null): void {
    const wasPlaying = this.playing;
    this.loop = range ? normaliseLoop(this.song, range.fromMeasure, range.toMeasure) : null;
    this.loopTrainer.reset();
    this.rebuild();
    if (wasPlaying) this.start();
  }

  /** The beats the loop covers, `[fromBeat, toBeat)`. */
  get loopSpan(): { fromBeat: number; toBeat: number } | null {
    return this.loop ? loopBeats(this.song, this.loop) : null;
  }

  /** Raise the tempo by 5 % after every clean loop run, up to 100 % (P2-08). */
  get autoTempo(): boolean {
    return this.loopTrainer.options.autoTempo ?? false;
  }

  set autoTempo(on: boolean) {
    this.loopTrainer.options = { ...this.loopTrainer.options, autoTempo: on };
  }

  setMetronome(on: boolean): void {
    this.metronome = on;
    this.waitClick = null;
    const tl = this.timeline;
    if (tl) {
      const t = this.clock();
      this.clicks = on ? this.clickTimes(tl, Math.max(tl.beatAt(t), tl.startBeat)) : [];
      this.clicked = 0;
    }
    this.emitStatus();
  }

  private clickTimes(tl: Timeline, fromBeat: number): { time: number; accent: boolean }[] {
    return metronomeClicks(this.song, fromBeat, this.endBeat).map((c) => ({
      time: tl.timeOf(c.beat),
      accent: c.accent,
    }));
  }

  private noteIndex: Map<string, SongNote> | null = null;

  private onStep(step: Step | undefined): void {
    this.onExpected(step?.pitches ?? []);
    if (!step && this.mode === 'wait') {
      if (this.loop) this.finishWaitLoop();
      else this.finishWait();
    }
  }

  /** Expected pitches right now (for the keyboard highlight). */
  expected(): number[] {
    return this.expectedNotes().map((n) => n.pitch);
  }

  /** Notes expected right now: the keys to light up and the fingers to show on them (P4-08). */
  expectedNotes(): SongNote[] {
    if (this.mode === 'wait') {
      const remaining = new Set(this.wait.remaining);
      return (this.wait.current?.notes ?? []).filter((n) => remaining.has(n.pitch));
    }
    const tl = this.timeline;
    if (!tl) return [];
    const t = this.clock();
    return this.song.notes.filter((n) => {
      if (!this.inHands(n)) return false;
      const nt = tl.timeOf(n.startBeat);
      return nt <= t + 0.05 && nt + this.secondsFor(n) >= t;
    });
  }

  inHands(n: SongNote): boolean {
    return this.hands === 'both' || n.hand === this.hands;
  }

  private secondsFor(n: SongNote): number {
    const sec =
      this.tempoMap.beatToSeconds(n.startBeat + n.durationBeats) -
      this.tempoMap.beatToSeconds(n.startBeat);
    return sec / this.tempo;
  }

  // --- Input ---------------------------------------------------------------------------------

  input(e: NoteEvent): void {
    const t = this.clock();
    this.lastInputAt = t;
    if (e.source === 'touch' && this.soundForTouch && this.synth) {
      this.synth.play(e.pitch, t, 0.6, e.velocity ?? 90);
    }
    if ((e.source === 'midi' || e.source === 'native-midi') && this.midiEcho) {
      this.echoVoices.get(e.pitch)?.stop(t);
      this.echoVoices.set(e.pitch, this.midiEcho.noteOn(e.pitch, e.velocity ?? 90, t));
    }
    if (!this.startedAt) this.startedAt = t;
    if (!this.runStartedAt) this.runStartedAt = t;
    this.keys.set(e.pitch, 'held');
    this.strikes.set(e.pitch, t);
    if (this.recordingKeys()) {
      this.recorder.noteOn({ ...e, time: e.time - (this.latency[e.source] ?? 0) });
    }
    if (this.mode === 'wait') {
      const before = this.wait.current;
      const out = this.wait.handle(e);
      if (out.kind === 'correct') {
        this.keys.set(e.pitch, 'correct');
        this.flash(e.pitch, 'correct', t);
        this.tally.right(this.stepHadWrong ? 'good' : 'perfect');
        if (out.completed) this.stepHadWrong = false;
        for (const n of before?.notes ?? []) {
          if (n.pitch !== e.pitch) continue;
          if (!this.done.has(n.id)) this.startHold(n, e);
          this.done.add(n.id);
          if (!this.marks.has(n.id)) this.marks.set(n.id, 'correct');
        }
        if (out.completed && before) this.accompanyStep(before, t);
      } else if (out.kind === 'wrong') {
        this.keys.set(e.pitch, 'wrong');
        this.flash(e.pitch, 'wrong', t);
        this.tally.wrong();
        this.stepHadWrong = true;
        for (const n of before?.notes ?? [])
          if (!this.done.has(n.id)) this.marks.set(n.id, 'wrong');
      }
    } else if (this.mode === 'play-along' && this.scorer) {
      const out = this.scorer.handle(e);
      if (out.kind === 'judged') {
        const { judgement, note, offset } = out.result;
        this.judged.set(note.id, judgement);
        const written = this.noteById(note.id);
        if (written) this.startHold(written, e);
        this.marks.set(note.id, 'correct');
        this.done.add(note.id);
        this.tally.right(judgement === 'hit' ? 'perfect' : 'good');
        if (judgement === 'early' || judgement === 'late') {
          // The right note at the wrong moment: a timing colour and a label, not the red of a
          // wrong note (P1-24).
          this.flash(e.pitch, judgement, t);
          this.labels = this.labels.filter((l) => l.pitch !== e.pitch && l.until > t);
          this.labels.push({
            pitch: e.pitch,
            kind: judgement,
            offsetMs: Math.round((offset ?? 0) * 1000),
            until: t + 0.9,
          });
        } else {
          this.keys.set(e.pitch, 'correct');
          this.flash(e.pitch, 'correct', t);
        }
      } else {
        this.keys.set(e.pitch, 'wrong');
        this.flash(e.pitch, 'wrong', t);
        this.tally.wrong();
      }
    }
    this.emitStatus();
  }

  /** A key came up; `time` is the input's own time for it (practice clock). */
  release(pitch: number, time = this.clock()): void {
    this.keys.delete(pitch);
    this.recorder.noteOff(pitch, time);
    this.echoVoices.get(pitch)?.stop();
    this.echoVoices.delete(pitch);
    const hold = this.holds.get(pitch);
    if (!hold || hold.end !== undefined) return;
    hold.end = Math.max(hold.start, time);
    if (hold.judgement) return;
    let j = judgeHold(hold.length, hold.end - hold.start);
    // In wait mode the learner sets the pace; holding on while finding the next note is fine.
    if (j === 'long' && this.mode === 'wait') j = 'good';
    this.judgeHoldAs(hold, j, this.clock());
  }

  /** Key presses count for the run's recording while the run is on. */
  private recordingKeys(): boolean {
    return this.mode === 'wait' ? !this.wait.finished : this.mode === 'play-along' && this.playing;
  }

  private noteById(id: string): SongNote | undefined {
    this.noteIndex ??= new Map(this.song.notes.map((n) => [n.id, n]));
    return this.noteIndex.get(id);
  }

  private startHold(n: SongNote, e: NoteEvent): void {
    // The microphone hears a note start but not the key coming up.
    if (e.source === 'microphone') return;
    const start = e.time - (this.latency[e.source] ?? 0);
    this.holds.set(n.pitch, {
      pitch: n.pitch,
      noteId: n.id,
      hand: n.hand,
      start,
      length: this.secondsFor(n),
    });
  }

  private judgeHoldAs(hold: Hold, judgement: HoldJudgement, t: number): void {
    hold.judgement = judgement;
    this.holdStats = { ...this.holdStats, [judgement]: this.holdStats[judgement] + 1 };
    if (judgement === 'good') return;
    this.labels = this.labels.filter((l) => l.pitch !== hold.pitch && l.until > t);
    this.labels.push({ pitch: hold.pitch, kind: judgement, offsetMs: 0, until: t + 1.1 });
  }

  /** Hold bars drain; a note held past its length is judged (P4-09). */
  private runHolds(t: number): void {
    for (const [pitch, hold] of this.holds) {
      if (hold.end !== undefined) {
        if (t > hold.end + HOLD_FADE) this.holds.delete(pitch);
        continue;
      }
      if (hold.judgement) continue;
      const held = t - hold.start;
      if (this.mode === 'wait') {
        if (held >= hold.length) this.judgeHoldAs(hold, 'good', t);
      } else if (held > holdOverdueAfter(hold.length)) {
        this.judgeHoldAs(hold, 'long', t);
      }
    }
  }

  /** Clears what one run collects: holds, their counts and the recorded keys. */
  private resetRun(): void {
    this.holds.clear();
    this.holdStats = { good: 0, short: 0, long: 0 };
    this.recorder.clear();
    this.recording = null;
    this.noteIndex = null;
  }

  /** The last finished run as played and polished, ready for the piano (P4-09). */
  renderings(): { asPlayed: RenderNote[]; polished: RenderNote[] } | null {
    const r = this.recording;
    const t = this.clock();
    // Keys still held count up to now.
    const played: PlayedNote[] = this.recorder.notes.map((p) =>
      p.end === undefined ? { ...p, end: Math.max(p.start, t) } : { ...p },
    );
    if (!r || played.length === 0) return null;
    const part = polished(r.expected, played, {
      match: r.mode === 'wait' ? 'order' : 'time',
    });
    // polished() starts at the first practised note; the other hand may start earlier.
    const first = Math.min(...r.expected.map((n) => n.time));
    const t0 = Math.min(first, ...r.accompaniment.map((n) => n.time));
    const whole = [
      ...part.map((n) => ({ ...n, time: n.time + first - t0 })),
      ...r.accompaniment.map((n) => ({ ...n, time: n.time - t0 })),
    ].sort((a, b) => a.time - b.time || a.pitch - b.pitch);
    return { asPlayed: asPlayed(played), polished: whole };
  }

  /** Keeps what playback of the finished run needs. `timeOf` maps a beat onto the run's clock. */
  private keepRecording(timeOf: (beat: number) => number, notes: SongNote[], from: number): void {
    const length = (n: SongNote) => timeOf(n.startBeat + n.durationBeats) - timeOf(n.startBeat);
    const expected = notes.map((n) => ({
      id: n.id,
      pitch: n.pitch,
      time: timeOf(n.startBeat),
      duration: length(n),
      measureIndex: n.measureIndex,
    }));
    const to = this.loopSpan?.toBeat ?? this.song.lengthBeats;
    const accompaniment =
      this.hands === 'both' || !this.accompany
        ? []
        : this.song.notes
            .filter((n) => !this.inHands(n) && n.startBeat >= from - 1e-6 && n.startBeat < to)
            .map((n) => ({
              pitch: n.pitch,
              time: timeOf(n.startBeat),
              duration: Math.max(0.05, length(n)),
              velocity: 64,
            }));
    this.recording = { mode: this.mode, expected, accompaniment };
  }

  private flash(pitch: number, kind: Flash['kind'], t: number): void {
    this.flashes.push({ pitch, kind, until: t + 0.35 });
  }

  /** In wait mode, plays the other hand's notes that belong between this step and the next. */
  private accompanyStep(step: Step, t: number): void {
    if (!this.accompany || !this.synth || this.hands === 'both') return;
    const next = this.wait.current?.beat ?? this.loopSpan?.toBeat ?? this.song.lengthBeats;
    const secPerBeat = (b: number) => this.tempoMap.secondsPerBeatAt(b) / this.tempo;
    for (const n of accompanimentBetween(this.song, this.hands, step.beat, next)) {
      const when = t + (n.startBeat - step.beat) * secPerBeat(step.beat);
      this.synth.play(n.pitch, when, n.durationBeats * secPerBeat(n.startBeat), 70);
    }
  }

  /** A looped section was played through in wait mode: report it and start it again. */
  private finishWaitLoop(): void {
    const t = this.clock();
    const stats = this.wait.stats;
    const total = stats.correct + stats.wrong;
    this.reportLoopRun(
      { wrong: stats.wrong, missed: 0, accuracy: total === 0 ? 0 : stats.correct / total },
      this.runStartedAt ? t - this.runStartedAt : 0,
    );
    this.loopRestartAt = t + LOOP_PAUSE;
  }

  private reportLoopRun(
    run: { wrong: number; missed: number; accuracy: number },
    seconds: number,
  ): void {
    const playedTempo = this.tempo;
    const outcome = this.loopTrainer.record(run, playedTempo);
    if (outcome.raised) {
      this.tempo = outcome.tempo;
      this.onTempo(outcome.tempo);
    }
    this.emitLoopRun({ ...outcome, ...run, mode: this.mode, playedTempo, seconds });
  }

  private emitLoopRun(report: LoopRunReport): void {
    for (const fn of this.loopListeners) fn(report);
  }

  private finishWait(): void {
    const t = this.clock();
    this.finishedAt = t;
    const notes = this.steps.flatMap((s) => s.notes);
    const from = this.steps[0]?.beat ?? 0;
    const tl = new Timeline(this.song, this.tempo, 0, from);
    this.keepRecording((b) => tl.timeOf(b), notes, from);
    const stats = this.wait.stats;
    const total = stats.correct + stats.wrong;
    const summary: RunSummary = {
      notes: stats.correct,
      hit: stats.correct,
      early: 0,
      late: 0,
      missed: 0,
      extra: stats.wrong,
      accuracy: total === 0 ? 0 : stats.correct / total,
      meanOffsetMs: 0,
      hardestMeasures: [...stats.wrongByMeasure.entries()]
        .map(([measureIndex, problems]) => ({ measureIndex, problems }))
        .sort((a, b) => b.problems - a.problems)
        .slice(0, 3),
    };
    this.summary = summary;
    this.onFinish(summary, this.startedAt ? t - this.startedAt : 0);
  }

  // --- Listen and play-along ----------------------------------------------------------------

  /** Starts listen or play-along from the current step's beat, or from the loop's start. */
  start(): void {
    if (this.mode === 'wait') return;
    this.stop();
    const t = this.clock();
    const span = this.loopSpan;
    const fromBeat = span ? span.fromBeat : this.beatForStart();
    const toBeat = span ? span.toBeat : this.song.lengthBeats;
    this.endBeat = toBeat;
    this.timeline = new Timeline(this.song, this.tempo, t + LEAD_IN, fromBeat);
    this.summary = null;
    this.done.clear();
    this.judged.clear();
    this.labels = [];
    if (!span || !this.startedAt) this.startedAt = t + LEAD_IN;
    this.runStartedAt = t + LEAD_IN;
    this.marks.clear();
    this.resetRun();
    this.tally.reset();
    this.finishedAt = 0;
    this.homed = false;
    this.homing = null;
    const tl = this.timeline;
    const audible = this.song.notes.filter(
      (n) =>
        n.startBeat >= fromBeat - 1e-6 &&
        n.startBeat < toBeat - 1e-6 &&
        (this.mode === 'listen' || (this.accompany && !this.inHands(n))),
    );
    this.schedule = audible.map((note) => ({ note, time: tl.timeOf(note.startBeat) }));
    this.scheduled = 0;
    this.cues = this.song.notes
      .filter(
        (n) => this.inHands(n) && n.startBeat >= fromBeat - 1e-6 && n.startBeat < toBeat - 1e-6,
      )
      .map((n) => ({ pitch: n.pitch, time: tl.timeOf(n.startBeat) }))
      .sort((a, b) => a.time - b.time);
    this.cued = 0;
    this.clicks = this.metronome ? this.clickTimes(tl, fromBeat) : [];
    this.clicked = 0;
    if (this.mode === 'play-along') {
      const timed: TimedNote[] = tl.timedNotes(this.song, this.hands, toBeat - 1e-6);
      this.scorer = new PlayAlongScorer(timed, {
        tempoFactor: this.tempo,
        latencyBySource: this.latency,
      });
    }
    // Count-in clicks over the lead-in.
    const beatSec = this.tempoMap.secondsPerBeatAt(fromBeat) / this.tempo;
    for (let k = 1; k <= 4; k++) {
      const when = t + LEAD_IN - k * beatSec;
      if (when > t) this.click(when, k === 4);
    }
    this.emitStatus();
  }

  stop(): void {
    this.timeline = null;
    this.scorer = null;
    this.schedule = [];
    this.clicks = [];
    // Notes already sent ahead to a MIDI keyboard would otherwise keep sounding.
    this.synth?.silence?.();
    this.emitStatus();
  }

  /**
   * Moves the position to `beat`, as dragging the score does (P4-18): the score, the cursor and the
   * falling notes all follow. A playing run stops, and Play starts again from here; wait mode moves
   * to the step at or after `beat`. Marks already made stay on the notes before it.
   */
  seek(beat: number): void {
    const from = this.loopSpan?.fromBeat ?? 0;
    const to = this.loopSpan?.toBeat ?? this.song.lengthBeats;
    const target = Math.min(Math.max(beat, from), to);
    if (this.timeline) this.stop();
    this.finishedAt = 0;
    this.homed = false;
    this.homing = null;
    this.summary = null;
    this.beat = target;
    if (this.mode === 'wait' && this.steps.length > 0) {
      const at = this.steps.findIndex((s) => s.beat >= target - 1e-6);
      // Past the last step, wait on the last one rather than finishing the run.
      const index = at < 0 ? this.steps.length - 1 : at;
      for (const s of this.steps.slice(index)) for (const n of s.notes) this.done.delete(n.id);
      if (index !== this.wait.index) this.wait.seek(index);
    }
    this.emitStatus();
  }

  private beatForStart(): number {
    const first = this.steps[0]?.beat ?? 0;
    return this.beat > first + 1e-6 && this.beat < this.song.lengthBeats ? this.beat : first;
  }

  // --- Per frame ----------------------------------------------------------------------------

  frame(): void {
    const t = this.clock();
    const perf = performance.now() / 1000;
    const dt = this.lastFramePerf ? Math.min(0.1, perf - this.lastFramePerf) : 0;
    this.lastFramePerf = perf;
    this.flashes = this.flashes.filter((f) => f.until > t);
    // A little after a run ends, the display glides back to the start of the piece, keeping the
    // marks and the summary. The score view rides along on `beat` (score-controller.ts).
    if (this.finishedAt > 0 && !this.homed && t - this.finishedAt > HOME_AFTER_SECONDS) {
      this.homed = true;
      const to = this.homeBeat;
      if (this.glideHome && Math.abs(this.beat - to) > 1e-3) {
        this.homing = { from: this.beat, to, at: t, seconds: homeSeconds(this.beat - to) };
      } else this.beat = to;
    }
    if (this.homing) {
      const h = this.homing;
      const k = Math.min(1, Math.max(0, (t - h.at) / h.seconds));
      this.beat = h.from + (h.to - h.from) * easeInOut(k);
      if (k >= 1) this.homing = null;
    }
    if (this.holds.size > 0) this.runHolds(t);
    if (this.labels.length > 0) this.labels = this.labels.filter((l) => l.until > t);
    for (const [pitch, state] of this.keys) {
      if (state !== 'held' && !this.flashes.some((f) => f.pitch === pitch))
        this.keys.set(pitch, 'held');
    }
    if (this.mode === 'wait') {
      if (this.loopRestartAt && t >= this.loopRestartAt) {
        this.loopRestartAt = 0;
        this.runStartedAt = 0;
        this.resetRun();
        this.done.clear();
        this.wait.reset();
      }
      this.runWaitClick(t);
      const target =
        this.homed || this.scrubbing
          ? this.beat
          : (this.wait.current?.beat ?? this.loopSpan?.toBeat ?? this.song.lengthBeats);
      // Time-based easing: the same glide at 60 and 120 Hz (a per-frame factor ran twice as fast).
      this.beat += (target - this.beat) * (1 - Math.exp(-dt * 11));
      if (Math.abs(target - this.beat) < 1e-3) this.beat = target;
    } else if (this.timeline) {
      // The picture follows a steady clock; judging and scheduling use the audio clock itself.
      this.beat = this.timeline.beatAt(this.display());
      this.runSchedule(t);
      // The piece strikes its own keys as their notes start, so a repeated note dips the key again.
      while (this.cued < this.cues.length) {
        const c = this.cues[this.cued];
        if (!c || c.time > t) break;
        this.cued += 1;
        this.strikes.set(c.pitch, c.time);
      }
      if (this.scorer) {
        for (const r of this.scorer.update(t)) {
          this.judged.set(r.note.id, 'missed');
          this.flash(r.note.pitch, 'missed', t);
          this.marks.set(r.note.id, 'wrong');
          this.tally.missed();
        }
        if (this.mode === 'play-along') {
          this.onExpected(this.upcomingPitches(t));
        }
      }
      const end = this.timeline.timeOf(this.endBeat);
      if (t > end + 0.3) this.finishPlayback(t);
    }
    this.emitStatus();
  }

  /** The steady click in wait mode: it keeps time at the practice tempo, whatever is played. */
  private runWaitClick(t: number): void {
    const audible = this.clickOut !== null || this.synth !== null;
    if (!this.metronome || !audible || (this.wait.finished && !this.loop)) {
      this.waitClick = null;
      return;
    }
    // Start afresh after a pause (a background tab) instead of catching up.
    if (!this.waitClick || this.waitClick.next < t - 0.5) {
      this.waitClick = { next: t + 0.1, count: 0 };
    }
    const beat = this.wait.current?.beat ?? this.loopSpan?.fromBeat ?? 0;
    const { unit, perBar } = pulseAt(this.song, beat);
    const interval = Math.max(0.1, (this.tempoMap.secondsPerBeatAt(beat) * unit) / this.tempo);
    while (this.waitClick.next < t + SCHEDULE_AHEAD) {
      this.click(this.waitClick.next, this.waitClick.count % perBar === 0);
      this.waitClick.next += interval;
      this.waitClick.count += 1;
    }
  }

  private upcomingPitches(t: number): number[] {
    const tl = this.timeline;
    if (!tl) return [];
    const set = new Set<number>();
    for (const n of this.song.notes) {
      if (!this.inHands(n)) continue;
      const nt = tl.timeOf(n.startBeat);
      if (nt > t - 0.15 && nt < t + 0.35) set.add(n.pitch);
    }
    return [...set].sort((a, b) => a - b);
  }

  private runSchedule(t: number): void {
    while (this.clicked < this.clicks.length) {
      const c = this.clicks[this.clicked];
      if (!c || c.time > t + SCHEDULE_AHEAD) break;
      this.clicked += 1;
      if (c.time >= t - 0.05) this.click(c.time, c.accent);
    }
    if (!this.synth) return;
    while (this.scheduled < this.schedule.length) {
      const s = this.schedule[this.scheduled];
      if (!s || s.time > t + SCHEDULE_AHEAD) break;
      this.scheduled += 1;
      if (s.time < t - 0.05) continue;
      this.synth.play(s.note.pitch, s.time, this.secondsFor(s.note), s.note.velocity ?? 80);
    }
  }

  private finishPlayback(t: number): void {
    const scorer = this.scorer;
    const tl = this.timeline;
    this.timeline = null;
    this.finishedAt = t;
    let summary: RunSummary | null = null;
    if (scorer && tl && this.mode === 'play-along') {
      scorer.finish();
      const measureAt = (time: number) => {
        const beat = tl.beatAt(time);
        return this.song.measures.findLast((m) => m.startBeat <= beat + 1e-6)?.index;
      };
      summary = summarise(
        scorer.results,
        scorer.extras.map((e) => ({ measureIndex: measureAt(e.time) })),
      );
    }
    this.scorer = null;
    if (this.loop) {
      // Looping: report the run and go round again; the whole-piece summary is not shown.
      const seconds = this.runStartedAt ? t - this.runStartedAt : 0;
      if (summary) {
        this.reportLoopRun(
          { wrong: summary.extra, missed: summary.missed, accuracy: summary.accuracy },
          seconds,
        );
      } else {
        this.emitLoopRun({
          run: 0,
          clean: true,
          streak: 0,
          tempo: this.tempo,
          raised: false,
          mode: this.mode,
          accuracy: 1,
          wrong: 0,
          missed: 0,
          playedTempo: this.tempo,
          seconds,
        });
      }
      this.start();
      return;
    }
    if (summary && tl) {
      const end = this.endBeat;
      const notes = this.song.notes.filter(
        (n) => this.inHands(n) && n.startBeat >= tl.startBeat - 1e-6 && n.startBeat < end - 1e-6,
      );
      this.keepRecording((b) => tl.timeOf(b), notes, tl.startBeat);
    }
    if (summary) {
      this.summary = summary;
      this.onFinish(summary, t - this.startedAt);
    }
    this.emitStatus();
  }
}
