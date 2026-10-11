// Standard MIDI File → Song (spec §8 "Rules for MIDI files").
import { splitHands } from './handsplit';
import { ImportError } from './errors';
import { looksNotated, quantise, quantiseNotated } from './quantise';
import { TempoMap } from './tempo';
import type {
  KeySignatureEvent,
  Measure,
  Song,
  SongNote,
  TempoEvent,
  TimeSignatureEvent,
} from './types';

export interface MidiNoteRaw {
  track: number;
  channel: number;
  program: number;
  pitch: number;
  velocity: number;
  startTick: number;
  endTick: number;
}

export interface MidiFile {
  format: number;
  ppq: number;
  trackNames: string[];
  notes: MidiNoteRaw[];
  tempos: { tick: number; bpm: number }[];
  timeSignatures: { tick: number; numerator: number; denominator: number }[];
  keySignatures: { tick: number; fifths: number; minor: boolean }[];
}

class Reader {
  pos = 0;
  constructor(private readonly b: Uint8Array) {}
  get remaining(): number {
    return this.b.length - this.pos;
  }
  u8(): number {
    if (this.pos >= this.b.length) throw new ImportError('This MIDI file is cut short.');
    return this.b[this.pos++] as number;
  }
  bytes(n: number): Uint8Array {
    if (this.pos + n > this.b.length) throw new ImportError('This MIDI file is cut short.');
    const out = this.b.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
  u16(): number {
    return (this.u8() << 8) | this.u8();
  }
  u32(): number {
    return ((this.u8() << 24) | (this.u8() << 16) | (this.u8() << 8) | this.u8()) >>> 0;
  }
  varlen(): number {
    let v = 0;
    for (let i = 0; i < 4; i++) {
      const b = this.u8();
      v = (v << 7) | (b & 0x7f);
      if ((b & 0x80) === 0) return v;
    }
    throw new ImportError('This MIDI file has a malformed length.');
  }
  ascii(n: number): string {
    return String.fromCharCode(...this.bytes(n));
  }
}

/** Parses an SMF (format 0 or 1, PPQ timing). */
export function parseMidiFile(bytes: Uint8Array): MidiFile {
  const r = new Reader(bytes);
  if (r.remaining < 14 || r.ascii(4) !== 'MThd') throw new ImportError('This is not a MIDI file.');
  const headerLength = r.u32();
  const header = new Reader(r.bytes(headerLength));
  const format = header.u16();
  const ntracks = header.u16();
  const division = header.u16();
  if (division & 0x8000) {
    throw new ImportError('MIDI files with SMPTE timing are not supported.');
  }
  const ppq = division || 480;
  const file: MidiFile = {
    format,
    ppq,
    trackNames: [],
    notes: [],
    tempos: [],
    timeSignatures: [],
    keySignatures: [],
  };

  for (let t = 0; t < ntracks && r.remaining >= 8; t++) {
    const id = r.ascii(4);
    const length = r.u32();
    const body = r.bytes(Math.min(length, r.remaining));
    if (id !== 'MTrk') continue;
    const tr = new Reader(body);
    let tick = 0;
    let status = 0;
    let name = '';
    const program = new Array<number>(16).fill(0);
    const open = new Map<number, { start: number; velocity: number; program: number }[]>();
    while (tr.remaining > 0) {
      tick += tr.varlen();
      let b = tr.u8();
      if (b < 0x80) {
        if (status === 0) throw new ImportError('This MIDI file is malformed (running status).');
        tr.pos -= 1;
        b = status;
      } else if (b < 0xf0) {
        status = b;
      }
      if (b === 0xff) {
        const type = tr.u8();
        const len = tr.varlen();
        const data = tr.bytes(len);
        if (type === 0x03 && !name) name = new TextDecoder().decode(data).trim();
        else if (type === 0x51 && len === 3) {
          const us = ((data[0] ?? 0) << 16) | ((data[1] ?? 0) << 8) | (data[2] ?? 0);
          if (us > 0) file.tempos.push({ tick, bpm: 60_000_000 / us });
        } else if (type === 0x58 && len >= 2) {
          file.timeSignatures.push({
            tick,
            numerator: data[0] ?? 4,
            denominator: 2 ** (data[1] ?? 2),
          });
        } else if (type === 0x59 && len >= 2) {
          const sf = data[0] ?? 0;
          file.keySignatures.push({ tick, fifths: sf > 127 ? sf - 256 : sf, minor: data[1] === 1 });
        } else if (type === 0x2f) break;
        continue;
      }
      if (b === 0xf0 || b === 0xf7) {
        tr.bytes(tr.varlen());
        continue;
      }
      const ch = b & 0x0f;
      switch (b & 0xf0) {
        case 0x80:
        case 0x90: {
          const pitch = tr.u8();
          const velocity = tr.u8();
          const key = ch * 128 + pitch;
          if ((b & 0xf0) === 0x90 && velocity > 0) {
            const list = open.get(key) ?? [];
            list.push({ start: tick, velocity, program: program[ch] ?? 0 });
            open.set(key, list);
          } else {
            const on = open.get(key)?.shift();
            if (on && tick > on.start) {
              file.notes.push({
                track: t,
                channel: ch,
                program: on.program,
                pitch,
                velocity: on.velocity,
                startTick: on.start,
                endTick: tick,
              });
            }
          }
          break;
        }
        case 0xc0:
          program[ch] = tr.u8();
          break;
        case 0xd0:
          tr.u8();
          break;
        default:
          tr.bytes(2);
      }
    }
    // Notes never released end with the track.
    for (const [key, list] of open) {
      for (const on of list) {
        if (tick > on.start) {
          file.notes.push({
            track: t,
            channel: Math.floor(key / 128),
            program: on.program,
            pitch: key % 128,
            velocity: on.velocity,
            startTick: on.start,
            endTick: tick,
          });
        }
      }
    }
    file.trackNames[t] = name;
  }
  return file;
}

export interface MidiImportOptions {
  /** Used when the file has no track name. */
  fallbackTitle?: string;
  /** Keep the drum channel and non-piano instruments (spec §8 drops them by default). */
  keepAllInstruments?: boolean;
  /** Split point for one-track files (default middle C). */
  splitPoint?: number;
}

/** Piano family: General MIDI programs 0–7. */
const isPianoProgram = (p: number) => p >= 0 && p <= 7;

export function midiToSong(bytes: Uint8Array, options: MidiImportOptions = {}): Song {
  const file = parseMidiFile(bytes);
  const warnings: string[] = [];
  let raw = file.notes;
  if (!options.keepAllInstruments) {
    const kept = raw.filter((n) => n.channel !== 9 && isPianoProgram(n.program));
    if (kept.length === 0 && raw.some((n) => n.channel !== 9)) {
      warnings.push('No piano parts were found, so all non-drum instruments were kept.');
      raw = raw.filter((n) => n.channel !== 9);
    } else {
      if (kept.length < raw.length) {
        warnings.push('Drums and non-piano instruments were left out.');
      }
      raw = kept;
    }
  }
  if (raw.length === 0) throw new ImportError('This MIDI file contains no notes to play.');

  const ppq = file.ppq;
  const tempos: TempoEvent[] = dedupe(
    file.tempos
      .sort((a, b) => a.tick - b.tick)
      .map((t) => ({ beat: t.tick / ppq, bpm: Math.round(t.bpm * 1000) / 1000 })),
  );
  if (tempos.length === 0 || (tempos[0]?.beat ?? 0) > 0) {
    tempos.unshift({ beat: 0, bpm: tempos[0]?.bpm ?? 120 });
  }
  const tempoMap = new TempoMap(tempos);

  // A file written by notation software keeps its written rhythm; a played one is snapped to the
  // grid that fits the playing (spec §8).
  const q = looksNotated(raw, ppq)
    ? { notes: quantiseNotated(raw, ppq) }
    : quantise(
        raw.map((n) => ({
          startBeat: n.startTick / ppq,
          durationBeats: (n.endTick - n.startTick) / ppq,
        })),
        tempoMap,
      );

  // Hands: two or more tracks → by average pitch; one track → pitch split with smoothing.
  const tracks = [...new Set(raw.map((n) => n.track))];
  let hands: ('left' | 'right')[];
  if (tracks.length >= 2) {
    const avg = new Map<number, number>();
    for (const t of tracks) {
      const own = raw.filter((n) => n.track === t);
      avg.set(t, own.reduce((s, n) => s + n.pitch, 0) / own.length);
    }
    const lowest = tracks.reduce((a, b) => ((avg.get(a) ?? 0) <= (avg.get(b) ?? 0) ? a : b));
    const mid = [...avg.values()].reduce((s, v) => s + v, 0) / avg.size;
    hands = raw.map((n) =>
      n.track === lowest || (tracks.length > 2 && (avg.get(n.track) ?? 0) < mid) ? 'left' : 'right',
    );
  } else {
    hands = splitHands(
      raw.map((n, i) => ({ pitch: n.pitch, startBeat: q.notes[i]?.startBeat ?? 0 })),
      options.splitPoint,
    );
  }

  const lengthBeats = Math.max(
    ...q.notes.map((n) => n.startBeat + n.durationBeats),
    ...tempos.map((t) => t.beat),
  );
  const timeSignatures = changes(
    file.timeSignatures.map((t) => ({
      beat: t.tick / ppq,
      numerator: t.numerator,
      denominator: t.denominator,
    })),
    (a, b) => a.numerator === b.numerator && a.denominator === b.denominator,
  );
  if (timeSignatures.length === 0 || (timeSignatures[0]?.beat ?? 0) > 0) {
    timeSignatures.unshift({ beat: 0, numerator: 4, denominator: 4 });
  }
  const keySignatures = changes<KeySignatureEvent>(
    file.keySignatures.map((k) => ({
      beat: k.tick / ppq,
      fifths: k.fifths,
      mode: k.minor ? 'minor' : 'major',
    })),
    (a, b) => a.fifths === b.fifths && a.mode === b.mode,
  );
  const measures = measuresFromTimeSignatures(timeSignatures, lengthBeats);

  const notes: SongNote[] = raw
    .map((n, i) => {
      const qn = q.notes[i] ?? { startBeat: 0, durationBeats: 1 };
      const hand = hands[i] ?? 'right';
      return {
        id: '',
        pitch: n.pitch,
        startBeat: qn.startBeat,
        durationBeats: qn.durationBeats,
        hand,
        staff: hand === 'right' ? 1 : 2,
        voice: 1,
        part: 0,
        measureIndex: measureIndexAt(measures, qn.startBeat),
        velocity: n.velocity,
        sourceRefs: [],
      };
    })
    .sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch);
  notes.forEach((n, i) => (n.id = `n${i}`));

  const named = file.trackNames.find((n) => n && !/^(track|piano)\s*\d*$/i.test(n));
  return {
    title: named ?? options.fallbackTitle ?? 'Untitled',
    format: 'midi',
    notes,
    measures,
    tempos,
    timeSignatures,
    keySignatures,
    parts: [{ name: 'Piano' }],
    lengthBeats: measures.reduce((s, m) => s + m.lengthBeats, 0),
    warnings,
  };
}

/**
 * Events in order, one per beat (the last wins), kept only where the value changes. Notation
 * software repeats key and time signatures on every track (MuseScore writes them once per staff).
 */
function changes<T extends { beat: number }>(events: T[], same: (a: T, b: T) => boolean): T[] {
  const out: T[] = [];
  for (const e of [...events].sort((a, b) => a.beat - b.beat)) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.beat - e.beat) < 1e-9) out[out.length - 1] = e;
    else if (!last || !same(last, e)) out.push(e);
  }
  return out;
}

function dedupe(tempos: TempoEvent[]): TempoEvent[] {
  const out: TempoEvent[] = [];
  for (const t of tempos) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.beat - t.beat) < 1e-9) last.bpm = t.bpm;
    else if (!last || last.bpm !== t.bpm) out.push({ ...t });
  }
  return out;
}

/** Bars laid out from the time signatures until `lengthBeats` is covered. */
export function measuresFromTimeSignatures(
  timeSignatures: readonly TimeSignatureEvent[],
  lengthBeats: number,
): Measure[] {
  const measures: Measure[] = [];
  let beat = 0;
  let sig = 0;
  while (beat < lengthBeats - 1e-6 || measures.length === 0) {
    while (
      sig + 1 < timeSignatures.length &&
      (timeSignatures[sig + 1]?.beat ?? Infinity) <= beat + 1e-6
    ) {
      sig += 1;
    }
    const ts = timeSignatures[sig] ?? { numerator: 4, denominator: 4 };
    let len = (ts.numerator * 4) / ts.denominator;
    const next = timeSignatures[sig + 1];
    if (next && next.beat > beat && next.beat < beat + len) len = next.beat - beat;
    const index = measures.length;
    measures.push({
      index,
      number: String(index + 1),
      sourceIndex: index,
      startBeat: beat,
      lengthBeats: len,
    });
    beat += len;
    if (measures.length > 100_000) break;
  }
  return measures;
}

export function measureIndexAt(measures: readonly Measure[], beat: number): number {
  let lo = 0;
  let hi = measures.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((measures[mid]?.startBeat ?? 0) <= beat + 1e-6) lo = mid;
    else hi = mid - 1;
  }
  return Math.max(0, lo);
}
