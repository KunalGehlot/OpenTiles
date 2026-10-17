// The score engraver (P5-13): Verovio in a worker of its own, so loading a score, laying it out and
// linking its notes never hold the page. A long piece took half a second of the main thread on a
// fast Mac (Für Elise, complete; the Menuett WoO 82) and more on an older iPad, which stalled the
// falling notes and the keys. One worker serves every score view; each open score has its own
// toolkit there, closed with its view. The page itself never loads Verovio.
import type { Song } from '@opentiles/song-model';
import type { DrawnScore } from './engrave-core';
import type { ScoreLinks } from './glyph-map';
import type { NotationSource } from './notation';

export type EngraveSource = Extract<NotationSource, { kind: 'musicxml' | 'abc' }>;

/** What the page asks the worker; `score` names an open score. */
export type EngraveRequest = { id: number; score: number } & (
  | { type: 'open'; source: EngraveSource }
  | { type: 'layout'; options: Record<string, unknown> }
  | { type: 'links'; song: Song; generated: boolean }
  | { type: 'close' }
);

export type EngraveReply =
  { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };

/** One open score in the worker. */
export interface Engraver {
  /** Lays the score out with these options and draws every page. */
  layout(options: Record<string, unknown>): Promise<DrawnScore>;
  /** Links the song's notes to the glyphs of the last layout. */
  links(song: Song, generated: boolean): Promise<ScoreLinks>;
  /** Frees the score's toolkit in the worker; later calls fail. */
  close(): void;
}

let worker: Worker | null = null;
const waiting = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>();
let nextId = 1;
let nextScore = 1;

function failAll(error: Error): void {
  for (const w of waiting.values()) w.reject(error);
  waiting.clear();
}

function engraverWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL('./engrave.worker.ts', import.meta.url), { type: 'module' });
  w.onmessage = (e: MessageEvent<EngraveReply>) => {
    const reply = e.data;
    const pending = waiting.get(reply.id);
    if (!pending) return;
    waiting.delete(reply.id);
    if (reply.ok) pending.resolve(reply.result);
    else pending.reject(new Error(reply.error));
  };
  // The worker could not start or crashed: every score in it is gone. The next score view starts a
  // new one.
  w.onerror = (e) => {
    e.preventDefault();
    if (worker === w) worker = null;
    w.terminate();
    failAll(new Error('The score engraver stopped.'));
  };
  worker = w;
  return w;
}

type RequestBody = EngraveRequest extends infer R
  ? R extends unknown
    ? Omit<R, 'id'>
    : never
  : never;

function call<T>(request: RequestBody): Promise<T> {
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    waiting.set(id, { resolve: resolve as (v: unknown) => void, reject });
    engraverWorker().postMessage({ ...request, id });
  });
}

/** Opens a score in the engraver; fails when Verovio cannot read it or cannot run here. */
export async function openEngraver(source: EngraveSource): Promise<Engraver> {
  const score = nextScore++;
  await call({ type: 'open', score, source });
  let closed = false;
  const live = () => {
    if (closed) throw new Error('This score was closed.');
  };
  return {
    layout: async (options) => {
      live();
      return call<DrawnScore>({ type: 'layout', score, options });
    },
    links: async (song, generated) => {
      live();
      return call<ScoreLinks>({ type: 'links', score, song, generated });
    },
    close: () => {
      if (closed) return;
      closed = true;
      call({ type: 'close', score }).catch(() => {
        // The worker is gone, and the score with it.
      });
    },
  };
}
