// Loop a section and practise phrase by phrase (PLAN.md P2-08, P3-04). Bars can be chosen by
// dragging across the falling notes or, accessibly, with the two bar selectors here.
import { useEffect, useRef, useState } from 'react';
import { splitPhrases, StepPractice } from '@opentiles/practice';
import type { LoopRange, PhraseRunOutcome } from '@opentiles/practice';
import type { Song } from '@opentiles/song-model';
import type { LoopRunReport, PracticeSession, SessionStatus } from '../views/session';

const pct = (x: number) => `${Math.round(x * 100)} %`;

const sameRange = (a: LoopRange | null | undefined, b: LoopRange | null | undefined) =>
  !!a && !!b && a.fromMeasure === b.fromMeasure && a.toMeasure === b.toMeasure;

export function SectionBar({
  session,
  song,
  status,
}: {
  session: PracticeSession;
  song: Song;
  status: SessionStatus;
}) {
  const [autoTempo, setAutoTempo] = useState(session.autoTempo);
  const [lastRun, setLastRun] = useState<LoopRunReport | null>(null);
  const [steps, setSteps] = useState<StepPractice | null>(null);
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [advice, setAdvice] = useState<PhraseRunOutcome | null>(null);
  const stepsRef = useRef(steps);
  stepsRef.current = steps;

  const loop = status.loop;
  const lastBar = Math.max(0, song.measures.length - 1);
  const label = (i: number) => song.measures[i]?.number ?? String(i + 1);

  useEffect(
    () =>
      session.addLoopListener((run) => {
        setLastRun(run);
        const sp = stepsRef.current;
        if (sp && run.run > 0) setAdvice(sp.record(run.accuracy));
      }),
    [session],
  );

  // A new loop (a drag, the selectors, Restart) starts its run count afresh; one that is not the
  // current phrase ends phrase-by-phrase practice.
  useEffect(() => {
    setLastRun(null);
    setAdvice(null);
    const current = stepsRef.current?.current;
    if (stepsRef.current && !sameRange(current, loop)) setSteps(null);
  }, [loop]);

  const setRange = (from: number, to: number) => {
    setSteps(null);
    session.setLoop({ fromMeasure: from, toMeasure: to });
  };

  const goToPhrase = (sp: StepPractice, index: number) => {
    const p = sp.goTo(index);
    setPhraseIndex(sp.index);
    setAdvice(null);
    if (p) session.setLoop({ fromMeasure: p.fromMeasure, toMeasure: p.toMeasure });
  };

  const togglePhrases = () => {
    if (steps) {
      setSteps(null);
      session.setLoop(null);
      return;
    }
    const sp = new StepPractice(splitPhrases(song, session.hands));
    if (sp.phrases.length === 0) return;
    // Start at the phrase holding the current loop or position.
    const bar = loop?.fromMeasure ?? session.wait.current?.measureIndex ?? 0;
    const start = Math.max(
      0,
      sp.phrases.findIndex((p) => p.fromMeasure <= bar && bar <= p.toMeasure),
    );
    stepsRef.current = sp;
    setSteps(sp);
    goToPhrase(sp, start);
  };

  const from = loop?.fromMeasure ?? 0;
  const to = loop?.toMeasure ?? lastBar;
  const bars = song.measures.map((_, i) => i);

  return (
    <div className="practice-bar section-bar" role="group" aria-label="Loop a section">
      <label>
        Loop bars
        <select
          aria-label="From bar"
          value={from}
          onChange={(e) => setRange(Number(e.target.value), Math.max(Number(e.target.value), to))}
        >
          {bars.map((i) => (
            <option key={i} value={i}>
              {label(i)}
            </option>
          ))}
        </select>
      </label>
      <label>
        to
        <select
          aria-label="To bar"
          value={to}
          onChange={(e) => setRange(Math.min(from, Number(e.target.value)), Number(e.target.value))}
        >
          {bars.map((i) => (
            <option key={i} value={i}>
              {label(i)}
            </option>
          ))}
        </select>
      </label>
      {loop && (
        <button
          onClick={() => {
            setSteps(null);
            session.setLoop(null);
          }}
        >
          Whole piece
        </button>
      )}
      <label title="After every run with no wrong or missed notes, play 5 % faster, up to 100 %">
        <input
          type="checkbox"
          checked={autoTempo}
          onChange={(e) => {
            setAutoTempo(e.target.checked);
            session.autoTempo = e.target.checked;
          }}
        />
        Speed up after clean runs
      </label>
      <button aria-pressed={steps !== null} onClick={togglePhrases}>
        Phrase by phrase
      </button>
      {steps && (
        <span className="row" role="group" aria-label="Phrase">
          <button
            aria-label="Previous phrase"
            disabled={phraseIndex === 0}
            onClick={() => goToPhrase(steps, phraseIndex - 1)}
          >
            ‹
          </button>
          <span>
            Phrase {phraseIndex + 1} of {steps.phrases.length}
          </span>
          <button
            aria-label="Next phrase"
            disabled={!steps.hasNext}
            onClick={() => goToPhrase(steps, phraseIndex + 1)}
          >
            ›
          </button>
        </span>
      )}
      <span className="loop-status" aria-live="polite">
        {loop && !lastRun && (
          <span className="muted">
            Looping bars {label(loop.fromMeasure)}–{label(loop.toMeasure)}
          </span>
        )}
        {lastRun && lastRun.run > 0 && (
          <span>
            Run {lastRun.run}: {lastRun.clean ? 'clean' : `${pct(lastRun.accuracy)}`}
            {lastRun.raised && <> · tempo up to {pct(lastRun.tempo)}</>}
          </span>
        )}
        {advice?.suggestNext && steps && (
          <>
            {' '}
            <span>That phrase is secure.</span>{' '}
            <button className="primary" onClick={() => goToPhrase(steps, phraseIndex + 1)}>
              Next phrase
            </button>
          </>
        )}
        {advice?.pieceDone && <span> Every phrase is secure. Try the whole piece!</span>}
      </span>
    </div>
  );
}
