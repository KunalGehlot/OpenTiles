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
export { buildPlayback, DEFAULT_VELOCITY, PlaybackCursor, playbackLength } from './playback';
export { EVEN_VELOCITY, touchVelocities } from './touch';
export {
  autoPedal,
  endingWarp,
  expressivePedals,
  expressiveVelocities,
  harmonyChanges,
  isPerformance,
} from './expression';
export type { Touch } from './touch';
export type {
  PedalKind,
  PedalState,
  PlaybackEvent,
  PlaybackNote,
  PlaybackOptions,
  PlaybackPedal,
  TimedPlaybackEvent,
  TimedPlaybackNote,
  TimedPlaybackPedal,
} from './playback';
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
export { fingerHand, suggestFingering, withFingering } from './fingering';
export type { Finger } from './fingering';
export {
  bestOctaveShift,
  customKeyboard,
  fitToKeyboard,
  FULL_PIANO,
  KEYBOARD_PRESETS,
  keyCount,
  notesOutside,
  presetById,
} from './keyboard-size';
export type { KeyboardPreset, KeyboardRange } from './keyboard-size';
export {
  asPlayed,
  HOLD_TOLERANCE,
  holdOverdueAfter,
  judgeHold,
  judgeHolds,
  PerformanceRecorder,
  polished,
} from './performance';
export type {
  HoldJudgement,
  HoldResult,
  PlayedNote,
  PolishOptions,
  RenderNote,
  TimedNoteWithLength,
} from './performance';
export { LiveTally, NO_LIVE_STATS } from './live-stats';
export type { LiveStats } from './live-stats';
export {
  DRILL_DEFAULTS,
  drillId,
  generateDrill,
  normaliseDrillOptions,
  parseDrillId,
  seededRandom,
  stepXml,
  stepPitch,
} from './drills';
export type { Drill, DrillClef, DrillKind, DrillNote, DrillOptions } from './drills';
export {
  CHORD_QUALITIES,
  chordKey,
  chordNotes,
  chordOn,
  chordPitchClasses,
  chordSymbol,
  invert,
  inversionsOf,
  noteCount,
  pitchClassOf,
  rootFor,
  shiftOctaves,
  voicing,
} from './chords';
export type {
  Chord,
  ChordQuality,
  ChordSymbolParts,
  Letter,
  PitchName,
  SpelledPitch,
} from './chords';
export {
  CHORD_DRILL_DEFAULTS,
  CHORD_LEVELS,
  CHORD_TEMPO_STEP,
  chordDrillId,
  chordKind,
  drillChords,
  drillEntries,
  generateChordDrill,
  isChordDrillId,
  leftPartOf,
  levelEntries,
  levelHands,
  MAX_CHORD_TEMPO,
  MIN_CHORD_TEMPO,
  mostNotesAtOnce,
  normaliseChordDrillOptions,
  normaliseChordSet,
  parseChordDrillId,
} from './chord-drills';
export type {
  ChordDrill,
  ChordDrillOptions,
  ChordEntry,
  ChordHands,
  ChordLevel,
  ChordSet,
  DrillChord,
  LeftPart,
} from './chord-drills';
export {
  CHORD_SPREAD,
  ChordTally,
  hardestChords,
  judgeTogether,
  mainCause,
  medianOf,
  missCause,
  STRICT_CHORD_SPREAD,
  summariseChords,
} from './chord-tally';
export type {
  ChordAttempt,
  ChordKindSummary,
  ChordMiss,
  ChordRoundSummary,
  TogetherJudgement,
} from './chord-tally';
export {
  addRound,
  kindTotals,
  MAX_ROUNDS,
  NO_CHORD_STATS,
  nextChordTempo,
  normaliseChordStats,
  recentShares,
  roundOf,
  WEAK_SHARE,
  weakChords,
} from './chord-stats';
export type { ChordKindStats, ChordRound, ChordStats } from './chord-stats';
export {
  isHeptatonic,
  isMinor,
  keyAlter,
  keySignatureOf,
  SCALE_KINDS,
  scaleKind,
  scaleLength,
  scaleNotes,
  scaleOn,
  tonicMidi,
} from './scales';
export type { Scale, ScaleKind, ScaleNote } from './scales';
export { degreeFingers, scaleFingers } from './scale-fingering';
export type { ScaleHand } from './scale-fingering';
export {
  drillEntries as scaleDrillEntries,
  drillScales,
  generateScaleDrill,
  isScaleDrillId,
  levelDefaults as scaleLevelDefaults,
  levelEntries as scaleLevelEntries,
  MAX_SCALE_COUNT,
  MAX_SCALE_TEMPO,
  MIN_SCALE_TEMPO,
  normaliseScaleDrillOptions,
  normaliseScaleSet,
  parseScaleDrillId,
  SCALE_DRILL_DEFAULTS,
  SCALE_LEVELS,
  SCALE_TEMPO_STEP,
  scaleDrillId,
  scaleSteps,
} from './scale-drills';
export type {
  DrillScale,
  DrillScaleNote,
  ScaleDrill,
  ScaleDrillOptions,
  ScaleEntry,
  ScaleHands,
  ScaleLevel,
  ScaleRhythm,
  ScaleSet,
  ScaleStep,
} from './scale-drills';
export {
  EVEN,
  evennessOf,
  evennessWord,
  hardestScales,
  mainScaleCause,
  ScaleTally,
  scaleMissCause,
  summariseScales,
  VERY_EVEN,
} from './scale-tally';
export type {
  ScaleAttempt,
  ScaleKindSummary,
  ScaleMiss,
  ScaleRoundSummary,
  UnevenAt,
} from './scale-tally';
export {
  addScaleRound,
  normaliseScaleStats,
  NO_SCALE_STATS,
  recentScaleShares,
  scaleRoundOf,
  scaleTotals,
  weakScales,
} from './scale-stats';
export type { ScaleKindStats, ScaleRound, ScaleStats } from './scale-stats';
export {
  chordReviewEvents,
  dueChordKinds,
  dueReviews,
  dueScaleKinds,
  gradeOf,
  localDayNumber,
  MAX_REVIEWS,
  MIN_EASE,
  nextEase,
  replayReviews,
  review,
  scaleReviewEvents,
  START_EASE,
} from './review';
export type { ReviewEvent, ReviewGrade, ReviewState } from './review';
