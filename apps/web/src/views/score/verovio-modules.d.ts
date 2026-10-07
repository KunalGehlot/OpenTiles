// Verovio ships no type declarations; src/views/score/verovio.ts narrows what it uses.
declare module 'verovio/wasm' {
  const createVerovioModule: () => Promise<unknown>;
  export default createVerovioModule;
}

declare module 'verovio/esm' {
  export const VerovioToolkit: unknown;
  export const LOG_OFF: number;
  export function enableLog(level: number, module: unknown): void;
}
