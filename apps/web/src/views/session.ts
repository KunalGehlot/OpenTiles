// The practice controller: song + mode + inputs → state the canvas draws each frame. Plain
// TypeScript, so timing-critical work never waits for React (AGENTS.md).
import {
  accompanimentBetween,
  buildSteps,
  LoopTrainer,
  loopBeats,
  metronomeClicks,
  normaliseLoop,
  PlayAlongScorer,
  pulseAt,
  summarise,
  Timeline,
  WaitMode,
} from '@opentiles/practice';
import type {
  HandFilter,
  InputSource,
  Judgement,
  LoopRange,
  LoopRunOutcome,
  NoteEvent,
  RunSummary,
  Step,
  TimedNote,
} from '@opentiles/practice';
import { TempoMap } from '@opentiles/song-model';
import type { Song, SongNote } from '@opentiles/song-model';
import type { PianoSynth } from '../audio/synth';

export type PracticeMode = 'wait' | 'listen' | 'play-along';

export type KeyState = 'held' | 'correct' | 'wrong';

export interface Flash {
  pitch: number;
  kind: 'correct' | 'wrong' | 'missed' | 'early' | 'late';
  until: number;
}

/** A live "early" / "late" label drawn above a key in play-along (P1-24). */
export interface TimingLabel {
  pitch: number;
  kind: 'early' | 'late';
  /** Played minus expected, ms. */
  offsetMs: number;
  until: number;
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
}

const LEAD_IN = 1.5;
const SCHEDULE_AHEAD = 0.3;
/** Pause between the end of a looped section and its next run in wait mode (seconds). */
const LOOP_PAUSE = 0.6;

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

  private timeline: Timeline | null = null;
  private scorer: PlayAlongScorer | null = null;
  private schedule: { note: SongNote; time: number }[] = [];
  private scheduled = 0;
  private startedAt = 0;
  private finishedAt = 0;
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
    this.flashes = [];
    this.summary = null;
    this.startedAt = 0;
    this.finishedAt = 0;
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

  private onStep(step: Step | undefined): void {
    this.onExpected(step?.pitches ?? []);
    if (!step && this.mode === 'wait') {
      if (this.loop) this.finishWaitLoop();
      else this.finishWait();
    }
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
    if (!this.runStartedAt) this.runStartedAt = t;
    this.keys.set(e.pitch, 'held');
    if (this.mode === 'wait') {
      const before = this.wait.current;
      const out = this.wait.handle(e);
      if (out.kind === 'correct') {
        this.keys.set(e.pitch, 'correct');
        this.flash(e.pitch, 'correct', t);
        for (const n of before?.notes ?? []) if (n.pitch === e.pitch) this.done.add(n.id);
        if (out.completed && before) this.accompanyStep(before, t);
      } else if (out.kind === 'wrong') {
        this.keys.set(e.pitch, 'wrong');
        this.flash(e.pitch, 'wrong', t);
      }
    } else if (this.mode === 'play-along' && this.scorer) {
      const out = this.scorer.handle(e);
      if (out.kind === 'judged') {
        const { judgement, note, offset } = out.result;
        this.judged.set(note.id, judgement);
        this.done.add(note.id);
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
    this.finishedAt = 0;
    const tl = this.timeline;
    const audible = this.song.notes.filter(
      (n) =>
        n.startBeat >= fromBeat - 1e-6 &&
        n.startBeat < toBeat - 1e-6 &&
        (this.mode === 'listen' || (this.accompany && !this.inHands(n))),
    );
    this.schedule = audible.map((note) => ({ note, time: tl.timeOf(note.startBeat) }));
    this.scheduled = 0;
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
    if (this.labels.length > 0) this.labels = this.labels.filter((l) => l.until > t);
    for (const [pitch, state] of this.keys) {
      if (state !== 'held' && !this.flashes.some((f) => f.pitch === pitch))
        this.keys.set(pitch, 'held');
    }
    if (this.mode === 'wait') {
      if (this.loopRestartAt && t >= this.loopRestartAt) {
        this.loopRestartAt = 0;
        this.runStartedAt = 0;
        this.done.clear();
        this.wait.reset();
      }
      this.runWaitClick(t);
      const target = this.wait.current?.beat ?? this.loopSpan?.toBeat ?? this.song.lengthBeats;
      this.beat += (target - this.beat) * 0.18;
      if (Math.abs(target - this.beat) < 1e-3) this.beat = target;
    } else if (this.timeline) {
      this.beat = this.timeline.beatAt(t);
      this.runSchedule(t);
      if (this.scorer) {
        for (const r of this.scorer.update(t)) {
          this.judged.set(r.note.id, 'missed');
          this.flash(r.note.pitch, 'missed', t);
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
    if (summary) {
      this.summary = summary;
      this.onFinish(summary, t - this.startedAt);
    }
    this.emitStatus();
  }
}
