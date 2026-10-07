export type { InputAdapter, InputSource, NoteEvent } from './events';
export { buildSteps, accompanimentBetween, includesHand } from './steps';
export type { HandFilter, Step } from './steps';
export { WaitMode } from './wait-mode';
export type { WaitOutcome, WaitStats } from './wait-mode';
export { PlayAlongScorer, windowScale } from './play-along';
export type {
  Judgement,
  NoteResult,
  PlayAlongOptions,
  PlayAlongOutcome,
  TimedNote,
} from './play-along';
export { summarise } from './summary';
export type { RunSummary } from './summary';
export { Timeline, clampTempo, MIN_TEMPO, MAX_TEMPO } from './timeline';
export { metronomeClicks, pulseAt, pulseOf, timeSignatureAt } from './metronome';
export type { Click, Pulse } from './metronome';
export {
  isCleanRun,
  LoopTrainer,
  loopBeats,
  loopFromBeats,
  measureAtBeat,
  nextLoopTempo,
  normaliseLoop,
} from './loop';
export type { LoopRange, LoopRun, LoopRunOutcome, LoopTrainerOptions } from './loop';
export { boundaryStrength, PHRASE_READY_ACCURACY, splitPhrases, StepPractice } from './phrases';
export type { Phrase, PhraseOptions, PhraseRunOutcome } from './phrases';
export {
  CALIBRATION_PITCHES,
  clickTrain,
  latencyFromAnswers,
  median,
  micLevelVerdict,
  rmsDb,
} from './calibration';
export type { LatencyOptions, LatencyResult, MicLevelVerdict } from './calibration';
