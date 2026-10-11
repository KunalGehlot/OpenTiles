// Test fixtures generated in code (self-made, CC0). No third-party scores in tests.
import { DOMParser } from '@xmldom/xmldom';
import type { DomParserLike } from '../src/musicxml';

export const domParser = new DOMParser() as unknown as DomParserLike;

export interface XmlNote {
  step?: string;
  alter?: number;
  octave?: number;
  /** In divisions. */
  duration: number;
  rest?: boolean;
  chord?: boolean;
  staff?: number;
  voice?: number;
  tie?: ('start' | 'stop')[];
  fingering?: number;
  grace?: boolean;
}

export function note(n: XmlNote): string {
  const pitch = n.rest
    ? '<rest/>'
    : `<pitch><step>${n.step}</step>${n.alter ? `<alter>${n.alter}</alter>` : ''}<octave>${n.octave}</octave></pitch>`;
  const ties = (n.tie ?? []).map((t) => `<tie type="${t}"/>`).join('');
  const tied = (n.tie ?? []).map((t) => `<tied type="${t}"/>`).join('');
  const fingering = n.fingering
    ? `<technical><fingering>${n.fingering}</fingering></technical>`
    : '';
  const notations = tied || fingering ? `<notations>${tied}${fingering}</notations>` : '';
  return `<note>${n.grace ? '<grace/>' : ''}${n.chord ? '<chord/>' : ''}${pitch}${
    n.grace ? '' : `<duration>${n.duration}</duration>`
  }${ties}<voice>${n.voice ?? 1}</voice>${n.staff ? `<staff>${n.staff}</staff>` : ''}${notations}</note>`;
}

export interface XmlMeasure {
  number?: string;
  implicit?: boolean;
  attributes?: string;
  content: string;
  left?: string;
  right?: string;
}

export function measure(m: XmlMeasure, i: number): string {
  return `<measure number="${m.number ?? i + 1}"${m.implicit ? ' implicit="yes"' : ''}>${
    m.left ? `<barline location="left">${m.left}</barline>` : ''
  }${m.attributes ? `<attributes>${m.attributes}</attributes>` : ''}${m.content}${
    m.right ? `<barline location="right">${m.right}</barline>` : ''
  }</measure>`;
}

export function score(
  parts: XmlMeasure[][],
  opts: { title?: string; partNames?: string[] } = {},
): string {
  const partList = parts
    .map(
      (_, i) =>
        `<score-part id="P${i + 1}"><part-name>${opts.partNames?.[i] ?? `Part ${i + 1}`}</part-name></score-part>`,
    )
    .join('');
  const body = parts
    .map((ms, i) => `<part id="P${i + 1}">${ms.map(measure).join('')}</part>`)
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">${opts.title ? `<work><work-title>${opts.title}</work-title></work>` : ''}<identification><creator type="composer">Test Composer</creator></identification><part-list>${partList}</part-list>${body}</score-partwise>`;
}

export const attrs = (opts: {
  divisions?: number;
  fifths?: number;
  beats?: number;
  beatType?: number;
  staves?: number;
  clefs?: string;
}) =>
  `${opts.divisions ? `<divisions>${opts.divisions}</divisions>` : ''}${
    opts.fifths !== undefined ? `<key><fifths>${opts.fifths}</fifths><mode>major</mode></key>` : ''
  }${opts.beats ? `<time><beats>${opts.beats}</beats><beat-type>${opts.beatType ?? 4}</beat-type></time>` : ''}${
    opts.staves ? `<staves>${opts.staves}</staves>` : ''
  }${opts.clefs ?? ''}`;

export const tempo = (bpm: number) =>
  `<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${bpm}</per-minute></metronome></direction-type><sound tempo="${bpm}"/></direction>`;

// --- MIDI writer --------------------------------------------------------------------------------

function varlen(v: number): number[] {
  const bytes = [v & 0x7f];
  while ((v >>= 7) > 0) bytes.unshift((v & 0x7f) | 0x80);
  return bytes;
}

export interface MidiEvent {
  tick: number;
  data: number[];
}

export function midiTrack(events: MidiEvent[]): number[] {
  const sorted = [...events].sort((a, b) => a.tick - b.tick);
  const out: number[] = [];
  let last = 0;
  for (const e of sorted) {
    out.push(...varlen(e.tick - last), ...e.data);
    last = e.tick;
  }
  out.push(0, 0xff, 0x2f, 0);
  return out;
}

export function midiFile(tracks: number[][], ppq = 480, format = 1): Uint8Array {
  const bytes = [
    0x4d,
    0x54,
    0x68,
    0x64,
    0,
    0,
    0,
    6,
    0,
    format,
    0,
    tracks.length,
    ppq >> 8,
    ppq & 0xff,
  ];
  for (const t of tracks) {
    bytes.push(
      0x4d,
      0x54,
      0x72,
      0x6b,
      (t.length >>> 24) & 0xff,
      (t.length >>> 16) & 0xff,
      (t.length >>> 8) & 0xff,
      t.length & 0xff,
      ...t,
    );
  }
  return new Uint8Array(bytes);
}

export const noteOn = (tick: number, pitch: number, velocity = 80, ch = 0): MidiEvent => ({
  tick,
  data: [0x90 | ch, pitch, velocity],
});
export const noteOff = (tick: number, pitch: number, ch = 0): MidiEvent => ({
  tick,
  data: [0x80 | ch, pitch, 0],
});
export const tempoEvent = (tick: number, bpm: number): MidiEvent => {
  const us = Math.round(60_000_000 / bpm);
  return { tick, data: [0xff, 0x51, 3, (us >> 16) & 0xff, (us >> 8) & 0xff, us & 0xff] };
};
export const trackName = (name: string): MidiEvent => ({
  tick: 0,
  data: [0xff, 0x03, name.length, ...[...name].map((c) => c.charCodeAt(0))],
});
export const program = (tick: number, prog: number, ch = 0): MidiEvent => ({
  tick,
  data: [0xc0 | ch, prog],
});
export const timeSignatureEvent = (tick: number, numerator: number, denominator: number) => ({
  tick,
  data: [0xff, 0x58, 4, numerator, Math.log2(denominator), 24, 8],
});
export const keySignatureEvent = (tick: number, fifths: number, minor = false) => ({
  tick,
  data: [0xff, 0x59, 2, fifths & 0xff, minor ? 1 : 0],
});

/** A note as written in a score: beats from the start, and its written value in beats. */
export interface WrittenNote {
  pitch: number;
  start: number;
  value: number;
  /** 0: upper staff, 1: lower staff. */
  track?: number;
}

/**
 * A MIDI file as notation software exports one (self-made, CC0): one track per staff, onsets on
 * the beat grid, each note sounding for 95 % of its written value, many tempo events. `rolled`
 * notes start a few ticks late and end with their chord, as a rolled chord is played.
 */
export function notatedMidi(
  notes: readonly (WrittenNote & { rollTicks?: number })[],
  opts: {
    ppq?: number;
    tempos?: [beat: number, bpm: number][];
    times?: [beat: number, numerator: number, denominator: number][];
    keys?: [beat: number, fifths: number][];
    gate?: number;
  } = {},
): Uint8Array {
  const ppq = opts.ppq ?? 480;
  const gate = opts.gate ?? 0.95;
  const tick = (beat: number) => Math.round(beat * ppq);
  const meta = [
    ...(opts.tempos ?? [[0, 100]]).map(([b, bpm]) => tempoEvent(tick(b), bpm)),
    ...(opts.times ?? [[0, 4, 4]]).map(([b, n, d]) => timeSignatureEvent(tick(b), n, d)),
  ];
  const keys = (opts.keys ?? [[0, 0]]).map(([b, f]) => keySignatureEvent(tick(b), f));
  const tracks = [0, 1].map((t) => {
    const own = notes.filter((n) => (n.track ?? 0) === t);
    const events: MidiEvent[] = [...keys, ...(t === 0 ? meta : [])];
    for (const n of own) {
      const on = tick(n.start) + (n.rollTicks ?? 0);
      const off = tick(n.start) + Math.round(n.value * ppq * gate);
      events.push(noteOn(on, n.pitch), noteOff(off, n.pitch));
    }
    // Note-offs before note-ons at the same tick, so repeated notes stay apart.
    return midiTrack(events.sort((a, b) => a.tick - b.tick || (a.data[0] ?? 0) - (b.data[0] ?? 0)));
  });
  return midiFile(tracks, ppq);
}
