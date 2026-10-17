// The score engraver's worker (P5-13, engraver.ts): Verovio's toolkits, one per open score.
// Requests are answered one at a time, in the order they came: Verovio is not re-entrant, and a
// score's layout must be done before its notes are linked.
import { drawPages, linkScore } from './engrave-core';
import type { DrawnScore } from './engrave-core';
import type { EngraveReply, EngraveRequest } from './engraver';
import { createToolkit } from './verovio';
import type { Toolkit } from './verovio';

const scope = globalThis as unknown as {
  onmessage: ((e: MessageEvent<EngraveRequest>) => void) | null;
  postMessage(message: EngraveReply): void;
};

/** Each open score: its toolkit and its last layout, which the linking reads. */
const scores = new Map<number, { tk: Toolkit; drawn: DrawnScore | null }>();

function score(id: number) {
  const s = scores.get(id);
  if (!s) throw new Error('This score is not open.');
  return s;
}

async function handle(request: EngraveRequest): Promise<unknown> {
  switch (request.type) {
    case 'open':
      scores.set(request.score, { tk: await createToolkit(request.source, {}), drawn: null });
      return null;
    case 'layout': {
      const s = score(request.score);
      s.drawn = drawPages(s.tk, request.options);
      return s.drawn;
    }
    case 'links': {
      const s = score(request.score);
      if (!s.drawn) throw new Error('The score has not been laid out.');
      return linkScore(s.tk, request.song, s.drawn, request.generated);
    }
    case 'close':
      scores.get(request.score)?.tk.destroy();
      scores.delete(request.score);
      return scores.size;
  }
}

let queue: Promise<void> = Promise.resolve();

scope.onmessage = (e) => {
  const request = e.data;
  queue = queue.then(async () => {
    try {
      scope.postMessage({ id: request.id, ok: true, result: await handle(request) });
    } catch (error) {
      scope.postMessage({
        id: request.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
};
