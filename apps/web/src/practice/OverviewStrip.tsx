// The whole piece as one thin strip above the falling notes (P5-07): a picture of its notes, the
// play position, the looped bars with a handle at each end, and, after a run, the bars with the
// most mistakes. Tap a bar to go there; drag along the strip to loop bars. The handles also move
// with the arrow keys. The position moves on every frame, so it is set directly, not through React.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { LoopRange } from '@opentiles/practice';
import type { Song } from '@opentiles/song-model';
import type { PracticeSession, SessionStatus } from '../views/session';
import { t } from '../i18n';
import {
  barAtFraction,
  fractionOfBeat,
  loopBetween,
  moveLoopEnd,
  noteMarks,
  sliceOfBars,
} from './overview';

/** Pointer travel (CSS px) before a press counts as a drag rather than a tap. */
const DRAG_THRESHOLD = 8;

type Grip = 'strip' | 'from' | 'to';

const percent = (x: number) => `${(x * 100).toFixed(3)}%`;

export function OverviewStrip({
  session,
  song,
  status,
  onLoop,
}: {
  session: PracticeSession;
  /** The piece as played (moved, fitted), the same one the session holds. */
  song: Song;
  status: SessionStatus;
  /** Called after the strip set a loop, so the loop controls can show. */
  onLoop: () => void;
}) {
  const stripRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; x: number; grip: Grip; moved: boolean } | null>(null);
  const [preview, setPreview] = useState<LoopRange | null>(null);
  const loop = status.loop;
  const lastBar = Math.max(0, song.measures.length - 1);
  const barLabel = (i: number) => song.measures[i]?.number ?? String(i + 1);

  // The picture of the notes: drawn once per piece, stretched to the strip, coloured by CSS.
  const marks = useMemo(() => noteMarks(song), [song]);

  // The play position, every frame.
  useEffect(() => {
    let raf = 0;
    let last = -1;
    const tick = () => {
      const f = fractionOfBeat(song, session.beat);
      if (trackRef.current && Math.abs(f - last) > 1e-5) {
        trackRef.current.style.transform = `translateX(${percent(f)})`;
        last = f;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [session, song]);

  const fractionAt = (clientX: number) => {
    const r = stripRef.current?.getBoundingClientRect();
    return r && r.width > 0 ? (clientX - r.left) / r.width : 0;
  };

  const rangeFor = (d: { x: number; grip: Grip }, clientX: number): LoopRange | null => {
    const f = fractionAt(clientX);
    if (d.grip === 'strip') return loopBetween(song, fractionAt(d.x), f);
    return loop ? moveLoopEnd(loop, d.grip, barAtFraction(song, f)) : null;
  };

  const onPointerDown = (e: React.PointerEvent, grip: Grip) => {
    if (e.button !== 0 || drag.current) return;
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    drag.current = { pointerId: e.pointerId, x: e.clientX, grip, moved: false };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    if (!d.moved && Math.abs(e.clientX - d.x) < DRAG_THRESHOLD) return;
    d.moved = true;
    setPreview(rangeFor(d, e.clientX));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    setPreview(null);
    if (e.type === 'pointercancel') return;
    if (!d.moved) {
      // A tap on the strip goes to the start of that bar.
      if (d.grip === 'strip') {
        const bar = barAtFraction(song, fractionAt(e.clientX));
        session.seek(song.measures[bar]?.startBeat ?? 0);
      }
      return;
    }
    const range = rangeFor(d, e.clientX);
    if (range) {
      session.setLoop(range);
      onLoop();
    }
  };

  const onHandleKey = (e: React.KeyboardEvent, end: 'from' | 'to') => {
    if (!loop) return;
    const current = end === 'from' ? loop.fromMeasure : loop.toMeasure;
    const moves: Record<string, number> = {
      ArrowLeft: current - 1,
      ArrowDown: current - 1,
      ArrowRight: current + 1,
      ArrowUp: current + 1,
      Home: 0,
      End: lastBar,
    };
    const bar = moves[e.key];
    if (bar === undefined) return;
    // Arrow keys may also be a page-turn pedal's; here they move the handle only.
    e.preventDefault();
    e.stopPropagation();
    session.setLoop(moveLoopEnd(loop, end, Math.max(0, Math.min(lastBar, bar))));
  };

  const shown = preview ?? loop;
  const shownSlice = shown ? sliceOfBars(song, shown.fromMeasure, shown.toMeasure) : null;
  const hardest =
    status.finished && status.summary
      ? status.summary.hardestMeasures.filter((m) => m.problems > 0)
      : [];

  return (
    <div
      ref={stripRef}
      className="overview"
      role="group"
      aria-label={t('Overview of the piece')}
      title={t('Tap a bar to go there; drag along the strip to loop bars.')}
      onPointerDown={(e) => onPointerDown(e, 'strip')}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <svg
        className="overview__notes"
        viewBox="0 0 1000 100"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {marks.map((m, i) => (
          <rect
            key={i}
            className={m.hand === 'left' ? 'overview__note--left' : 'overview__note--right'}
            x={m.x * 1000}
            y={4 + m.y * 82}
            width={Math.max(1.5, m.width * 1000 - 0.5)}
            height={12}
          />
        ))}
      </svg>
      {hardest.map((m) => {
        const s = sliceOfBars(song, m.measureIndex, m.measureIndex);
        return (
          <div
            key={m.measureIndex}
            className="overview__hard"
            data-testid="overview-hard"
            style={{ left: percent(s.left), width: percent(s.width) }}
            title={t('Bar {bar}: {n} mistakes', { bar: barLabel(m.measureIndex), n: m.problems })}
          />
        );
      })}
      {shown && shownSlice && (
        <div
          className={preview ? 'overview__loop overview__loop--preview' : 'overview__loop'}
          data-testid="overview-loop"
          style={{ left: percent(shownSlice.left), width: percent(shownSlice.width) }}
        >
          {/* Kept while a handle is dragged: it holds the pointer until the drag ends. */}
          {loop && (
            <>
              <div
                className="overview__handle overview__handle--from"
                role="slider"
                tabIndex={0}
                aria-label={t('Loop starts at bar')}
                aria-valuemin={1}
                aria-valuemax={lastBar + 1}
                aria-valuenow={loop.fromMeasure + 1}
                aria-valuetext={barLabel(loop.fromMeasure)}
                onPointerDown={(e) => onPointerDown(e, 'from')}
                onKeyDown={(e) => onHandleKey(e, 'from')}
              />
              <div
                className="overview__handle overview__handle--to"
                role="slider"
                tabIndex={0}
                aria-label={t('Loop ends at bar')}
                aria-valuemin={1}
                aria-valuemax={lastBar + 1}
                aria-valuenow={loop.toMeasure + 1}
                aria-valuetext={barLabel(loop.toMeasure)}
                onPointerDown={(e) => onPointerDown(e, 'to')}
                onKeyDown={(e) => onHandleKey(e, 'to')}
              />
            </>
          )}
        </div>
      )}
      <div ref={trackRef} className="overview__track" aria-hidden="true">
        <div className="overview__now" />
      </div>
    </div>
  );
}
