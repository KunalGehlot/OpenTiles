// The practice controller: song + mode + inputs → state the canvas draws each frame. Plain
// TypeScript, so timing-critical work never waits for React (AGENTS.md).
import {
  accompanimentBetween,
  buildSteps,
  PlayAlongScorer,
  summarise,
  Timeline,
  WaitMode,
} from '@opentiles/practice';
import type { HandFilter, NoteEvent, RunSummary, Step, TimedNote } from '@opentiles/practice';
import { TempoMap } from '@opentiles/song-model';
import type { Song, SongNote } from '@opentiles/song-model';
import type { PianoSynth } from '../audio/synth';

export type PracticeMode = 'wait' | 'listen' | 'play-along';

export type KeyState = 'held' | 'correct' | 'wrong';

export interface Flash {
  pitch: number;
  kind: 'correct' | 'wrong' | 'missed';
  until: number;
}

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
}

const LEAD_IN = 1.5;
const SCHEDULE_AHEAD = 0.3;

export class PracticeSession {
  readonly tempoMap: TempoMap;
  mode: PracticeMode = 'wait';
  hands: HandFilter = 'both';
  tempo = 1;
  accompany = true;
  /** Play a sound for notes from inputs that make none themselves (touch). */
  soundForTouch = true;

  steps: Step[] = [];
  wait: WaitMode;
  /** Beat shown at the now-line. */
  beat = 0;
  readonly keys = new Map<number, KeyState>();
  flashes: Flash[] = [];
  /** Note ids already played correctly in this run (drawn differently). */
  readonly done = new Set<string>();
  /**
   * Per-note feedback for the score views: `wrong` when a wrong key was played while the note was
   * expected (wait mode) or the note was missed (play-along); it stays red for the rest of the run.
   */
  readonly marks = new Map<string, 'correct' | 'wrong'>();

  private timeline: Timeline | null = null;
  private scorer: PlayAlongScorer | null = null;
  private schedule: { note: SongNote; time: number }[] = [];
  private scheduled = 0;
  private startedAt = 0;
  private finishedAt = 0;
  private summary: RunSummary | null = null;
  private lastStatus = '';

  /** UI listeners: called when something the controls show has changed. */
  onStatus: (s: SessionStatus) => void = () => {};
  /** Called with the pitches the microphone should listen for. */
  onExpected: (pitches: number[]) => void = () => {};
  /** Called when a run ends with its summary. */
  onFinish: (s: RunSummary, seconds: number) => void = () => {};

  constructor(
    readonly song: Song,
    private readonly clock: () => number,
    private synth: PianoSynth | null = null,
  ) {
    this.tempoMap = new TempoMap(song.tempos);
    this.wait = new WaitMode([]);
    this.rebuild();
  }

  setSynth(s: PianoSynth | null): void {
    this.synth = s;
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
      finished: this.mode === 'wait' ? this.wait.finished : this.summary !== null,
      stepIndex: this.wait.index,
      stepCount: this.steps.length,
      correct:
        this.mode === 'wait'
          ? stats.correct
          : judged.filter((r) => r.judgement !== 'missed').length,
      wrong: this.mode === 'wait' ? stats.wrong : (this.scorer?.extras.length ?? 0),
      summary: this.summary,
      elapsed: this.startedAt ? (this.finishedAt || this.clock()) - this.startedAt : 0,
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

  /** Rebuilds steps for the current hands and restarts from the beginning. */
  rebuild(): void {
    this.stop();
    this.steps = buildSteps(this.song, this.hands);
    this.wait = new WaitMode(this.steps);
    this.wait.onStep = (step) => this.onStep(step);
    this.done.clear();
    this.marks.clear();
    this.flashes = [];
    this.summary = null;
    this.startedAt = 0;
    this.finishedAt = 0;
    this.beat = this.steps[0]?.beat ?? 0;
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
    if (this.playing) this.start();
  }

  private onStep(step: Step | undefined): void {
    this.onExpected(step?.pitches ?? []);
    if (!step && this.mode === 'wait') this.finishWait();
  }

  /** Expected pitches right now (for the keyboard highlight). */
  expected(): number[] {
    if (this.mode === 'wait') return this.wait.remaining;
    if (!this.timeline) return [];
    const t = this.clock();
    return this.song.notes
      .filter((n) => this.inHands(n))
      .filter((n) => {
        const nt = this.timeline?.timeOf(n.startBeat) ?? 0;
        return nt <= t + 0.05 && nt + this.secondsFor(n) >= t;
      })
      .map((n) => n.pitch);
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
    if (e.source === 'touch' && this.soundForTouch && this.synth) {
      this.synth.play(e.pitch, t, 0.6, e.velocity ?? 90);
    }
    if (!this.startedAt) this.startedAt = t;
    this.keys.set(e.pitch, 'held');
    if (this.mode === 'wait') {
      const before = this.wait.current;
      const out = this.wait.handle(e);
      if (out.kind === 'correct') {
        this.keys.set(e.pitch, 'correct');
        this.flash(e.pitch, 'correct', t);
        for (const n of before?.notes ?? []) {
          if (n.pitch !== e.pitch) continue;
          this.done.add(n.id);
          if (!this.marks.has(n.id)) this.marks.set(n.id, 'correct');
        }
        if (out.completed && before) this.accompanyStep(before, t);
      } else if (out.kind === 'wrong') {
        this.keys.set(e.pitch, 'wrong');
        this.flash(e.pitch, 'wrong', t);
        for (const n of before?.notes ?? [])
          if (!this.done.has(n.id)) this.marks.set(n.id, 'wrong');
      }
    } else if (this.mode === 'play-along' && this.scorer) {
      const out = this.scorer.handle(e);
      if (out.kind === 'judged') {
        const ok = out.result.judgement === 'hit';
        this.keys.set(e.pitch, ok ? 'correct' : 'wrong');
        this.flash(e.pitch, ok ? 'correct' : 'wrong', t);
        this.done.add(out.result.note.id);
        this.marks.set(out.result.note.id, out.result.judgement === 'missed' ? 'wrong' : 'correct');
      } else {
        this.keys.set(e.pitch, 'wrong');
        this.flash(e.pitch, 'wrong', t);
      }
    }
    this.emitStatus();
  }

  release(pitch: number): void {
    this.keys.delete(pitch);
  }

  private flash(pitch: number, kind: Flash['kind'], t: number): void {
    this.flashes.push({ pitch, kind, until: t + 0.35 });
  }

  /** In wait mode, plays the other hand's notes that belong between this step and the next. */
  private accompanyStep(step: Step, t: number): void {
    if (!this.accompany || !this.synth || this.hands === 'both') return;
    const next = this.wait.current?.beat ?? this.song.lengthBeats;
    const secPerBeat = (b: number) => this.tempoMap.secondsPerBeatAt(b) / this.tempo;
    for (const n of accompanimentBetween(this.song, this.hands, step.beat, next)) {
      const when = t + (n.startBeat - step.beat) * secPerBeat(step.beat);
      this.synth.play(n.pitch, when, n.durationBeats * secPerBeat(n.startBeat), 70);
    }
  }

  private finishWait(): void {
    const t = this.clock();
    this.finishedAt = t;
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

  /** Starts listen or play-along from the current step's beat. */
  start(): void {
    if (this.mode === 'wait') return;
    this.stop();
    const t = this.clock();
    const fromBeat = this.beatForStart();
    this.timeline = new Timeline(this.song, this.tempo, t + LEAD_IN, fromBeat);
    this.summary = null;
    this.done.clear();
    this.marks.clear();
    this.startedAt = t + LEAD_IN;
    this.finishedAt = 0;
    const tl = this.timeline;
    const audible = this.song.notes.filter(
      (n) =>
        n.startBeat >= fromBeat - 1e-6 &&
        (this.mode === 'listen' || (this.accompany && !this.inHands(n))),
    );
    this.schedule = audible.map((note) => ({ note, time: tl.timeOf(note.startBeat) }));
    this.scheduled = 0;
    if (this.mode === 'play-along') {
      const timed: TimedNote[] = tl.timedNotes(this.song, this.hands);
      this.scorer = new PlayAlongScorer(timed, { tempoFactor: this.tempo });
    }
    // Count-in clicks over the lead-in.
    if (this.synth) {
      const beatSec = this.tempoMap.secondsPerBeatAt(fromBeat) / this.tempo;
      for (let k = 1; k <= 4; k++) {
        const when = t + LEAD_IN - k * beatSec;
        if (when > t) this.synth.click(when, k === 4);
      }
    }
    this.emitStatus();
  }

  stop(): void {
    this.timeline = null;
    this.scorer = null;
    this.schedule = [];
    this.emitStatus();
  }

  private beatForStart(): number {
    const first = this.steps[0]?.beat ?? 0;
    return this.beat > first + 1e-6 && this.beat < this.song.lengthBeats ? this.beat : first;
  }

  // --- Per frame ----------------------------------------------------------------------------

  frame(): void {
    const t = this.clock();
    this.flashes = this.flashes.filter((f) => f.until > t);
    for (const [pitch, state] of this.keys) {
      if (state !== 'held' && !this.flashes.some((f) => f.pitch === pitch))
        this.keys.set(pitch, 'held');
    }
    if (this.mode === 'wait') {
      const target = this.wait.current?.beat ?? this.song.lengthBeats;
      this.beat += (target - this.beat) * 0.18;
      if (Math.abs(target - this.beat) < 1e-3) this.beat = target;
    } else if (this.timeline) {
      this.beat = this.timeline.beatAt(t);
      this.runSchedule(t);
      if (this.scorer) {
        for (const r of this.scorer.update(t)) {
          this.flash(r.note.pitch, 'missed', t);
          this.marks.set(r.note.id, 'wrong');
        }
        if (this.mode === 'play-along') {
          this.onExpected(this.upcomingPitches(t));
        }
      }
      const end = this.timeline.timeOf(this.song.lengthBeats);
      if (t > end + 0.3) this.finishPlayback(t);
    }
    this.emitStatus();
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
    if (scorer && tl && this.mode === 'play-along') {
      scorer.finish();
      const measureAt = (time: number) => {
        const beat = tl.beatAt(time);
        return this.song.measures.findLast((m) => m.startBeat <= beat + 1e-6)?.index;
      };
      this.summary = summarise(
        scorer.results,
        scorer.extras.map((e) => ({ measureIndex: measureAt(e.time) })),
      );
      this.onFinish(this.summary, t - this.startedAt);
    }
    this.scorer = null;
    this.emitStatus();
  }
}
