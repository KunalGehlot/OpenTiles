// The Player's clock (P6-05): a dedicated worker that posts a tick every 25 ms. A hidden tab stops
// requestAnimationFrame and throttles the page's own timers (Chrome to once a second, and after
// five minutes hidden to once a minute for a page that makes no sound, which a page playing only on
// a MIDI keyboard is); a worker's timers keep their pace. The page does the scheduling on each tick.
const scope = globalThis as unknown as {
  onmessage: ((e: MessageEvent<'start' | 'stop'>) => void) | null;
  postMessage(message: unknown): void;
};

let timer: ReturnType<typeof setInterval> | undefined;

scope.onmessage = (e) => {
  clearInterval(timer);
  timer = e.data === 'start' ? setInterval(() => scope.postMessage(0), 25) : undefined;
};
