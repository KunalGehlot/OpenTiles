// The piece the Player is playing, as a slim bar on the other pages (P6-09): its tile, title,
// play or pause and next; a tap on the title opens the Player. It never makes the Player itself,
// so a page where the Player was not opened starts no clock, worker or MIDI access for it.
import { Pause, Play, SkipForward } from 'lucide-react';
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { t } from '../i18n';
import { href } from '../lib/router';
import { coverIndex, initials } from './art';
import { existingPlayer, watchPlayer } from './browser';
import type { Playable } from './transport';

export function MiniPlayer() {
  const transport = useSyncExternalStore(watchPlayer, existingPlayer);
  const subscribe = useCallback(
    (onChange: () => void) => transport?.subscribe(() => onChange()) ?? (() => {}),
    [transport],
  );
  const state = useSyncExternalStore(subscribe, () => transport?.state ?? null);
  // The piece stays shown while the next one loads.
  const shown = useRef<Playable | null>(null);
  if (state?.piece) shown.current = state.piece;
  if (!state?.key) shown.current = null;
  const playing = state?.status === 'playing' || state?.status === 'between';
  const progress = useRef<HTMLDivElement>(null);

  // The progress line moves every frame while playing, outside React.
  useEffect(() => {
    if (!transport) return;
    let raf = 0;
    const draw = () => {
      const { duration } = transport.state;
      const fraction = duration > 0 ? Math.min(1, transport.positionNow() / duration) : 0;
      if (progress.current) progress.current.style.transform = `scaleX(${fraction})`;
      if (playing) raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [transport, playing, state]);

  const piece = shown.current;
  if (!transport || !state || !piece) return null;
  const name = piece.composer ?? piece.title;
  return (
    <>
      <div className="shell-player" role="region" aria-label={t('Now playing')}>
        <div className="shell-player__progress" ref={progress} />
        <a
          className="shell-player__open"
          href={href({ name: 'player' })}
          title={t('Open the Player')}
        >
          <span className={`tile cover-${coverIndex(name)}`} aria-hidden="true">
            {initials(name)}
          </span>
          <span className="collection__text">
            <span className="collection__title">{piece.title}</span>
            <span className="collection__meta" role="status">
              {state.message === 'practice'
                ? t('Stopped while you practise.')
                : state.message === 'disconnected'
                  ? t('Your keyboard was disconnected.')
                  : piece.composer}
            </span>
          </span>
        </a>
        <button
          className="np-icon"
          aria-label={playing ? t('Pause') : t('Play')}
          onClick={() => void transport.toggle()}
        >
          {playing ? <Pause /> : <Play />}
        </button>
        <button
          className="np-icon"
          aria-label={t('Next piece')}
          onClick={() => void transport.next()}
        >
          <SkipForward />
        </button>
      </div>
      {/* Room under the page's end, so the bar never covers the footer. */}
      <div className="shell-player__room" aria-hidden="true" />
    </>
  );
}
