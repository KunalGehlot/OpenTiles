// 16-bit PCM WAV encoding for Detector Lab recordings (the Phase 0 test set, docs/phase-0).

export function encodeWav(chunks: readonly Float32Array[], sampleRate: number): Uint8Array {
  const length = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(44 + length * 2);
  const view = new DataView(out.buffer);
  const ascii = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) out[offset + i] = s.charCodeAt(i);
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + length * 2, true);
  ascii(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, length * 2, true);
  let o = 44;
  for (const c of chunks) {
    for (let i = 0; i < c.length; i++) {
      const s = Math.max(-1, Math.min(1, c[i] ?? 0));
      view.setInt16(o, Math.round(s * 32767), true);
      o += 2;
    }
  }
  return out;
}
