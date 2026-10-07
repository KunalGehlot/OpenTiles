// MusicXML (partwise) → Song. Runs in the browser with the global DOMParser; tests and workers
// can pass any DOMParser-compatible implementation.
import { stepToMidi } from './pitch';
import { DEFAULT_BPM } from './tempo';
import type {
  Hand,
  KeySignatureEvent,
  Measure,
  Part,
  Song,
  SongFormat,
  SongNote,
  TempoEvent,
  TimeSignatureEvent,
} from './types';

export interface DomParserLike {
  parseFromString(xml: string, type: string): Document;
}

export interface MusicXmlOptions {
  domParser?: DomParserLike;
  /** Recorded on the song; `mxl` when the XML came out of a compressed file. */
  format?: SongFormat;
}

export class ImportError extends Error {
  override name = 'ImportError';
}

interface RawNote {
  part: number;
  pitch: number;
  posBeats: number;
  durBeats: number;
  staff: number;
  voice: number;
  tieStart: boolean;
  tieStop: boolean;
  fingering?: number;
  ref: string;
}

interface RawMeasure {
  number: string;
  lengthBeats: number;
  notes: RawNote[];
  tempos: { posBeats: number; bpm: number }[];
  time?: { numerator: number; denominator: number };
  key?: { fifths: number; mode?: 'major' | 'minor' };
  forwardRepeat: boolean;
  backwardRepeat: boolean;
  repeatTimes: number;
  endingStart?: number[];
  endingStop: boolean;
}

interface PartInfo {
  name: string;
  staves: number;
  clefs: Map<number, string>;
}

// --- DOM helpers that work with both browser DOM and xmldom -----------------------------------

function elements(parent: Element | Document, name?: string): Element[] {
  const out: Element[] = [];
  for (let n = parent.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1 && (name === undefined || n.nodeName === name)) out.push(n as Element);
  }
  return out;
}

function child(parent: Element, name: string): Element | undefined {
  for (let n = parent.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1 && n.nodeName === name) return n as Element;
  }
  return undefined;
}

function path(parent: Element, ...names: string[]): Element | undefined {
  let el: Element | undefined = parent;
  for (const n of names) {
    if (!el) return undefined;
    el = child(el, n);
  }
  return el;
}

function text(el: Element | undefined): string | undefined {
  const t = el?.textContent?.trim();
  return t === undefined || t === '' ? undefined : t;
}

function num(el: Element | undefined): number | undefined {
  const t = text(el);
  if (t === undefined) return undefined;
  const v = Number(t);
  return Number.isFinite(v) ? v : undefined;
}

// --- Parsing ------------------------------------------------------------------------------------

const BEAT_UNIT_QUARTERS: Record<string, number> = {
  whole: 4,
  half: 2,
  quarter: 1,
  eighth: 0.5,
  '16th': 0.25,
  '32nd': 0.125,
};

function parseTempo(direction: Element): number | undefined {
  const sound = child(direction, 'sound');
  const fromSound = Number(sound?.getAttribute('tempo') ?? NaN);
  if (Number.isFinite(fromSound) && fromSound > 0) return fromSound;
  for (const dt of elements(direction, 'direction-type')) {
    const metronome = child(dt, 'metronome');
    if (!metronome) continue;
    const unit = BEAT_UNIT_QUARTERS[text(child(metronome, 'beat-unit')) ?? ''];
    const perMinute = num(child(metronome, 'per-minute'));
    if (unit === undefined || perMinute === undefined || perMinute <= 0) continue;
    const dotted = child(metronome, 'beat-unit-dot') ? 1.5 : 1;
    return perMinute * unit * dotted;
  }
  return undefined;
}

function parseEndingNumbers(attr: string | null): number[] {
  if (!attr) return [];
  return attr
    .split(/[,\s]+/)
    .map((s) => Number.parseInt(s, 10))
    .filter((n) => Number.isFinite(n) && n > 0);
}

export function parseMusicXml(xml: string, options: MusicXmlOptions = {}): Song {
  const parser: DomParserLike | undefined =
    options.domParser ?? (typeof DOMParser !== 'undefined' ? new DOMParser() : undefined);
  if (!parser) throw new ImportError('No XML parser is available in this environment.');
  const doc = parser.parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new ImportError('This file is not valid XML.');
  }
  const root = doc.documentElement;
  if (!root) throw new ImportError('This file is empty.');
  if (root.nodeName === 'score-timewise') {
    throw new ImportError('Timewise MusicXML is not supported yet. Export as partwise MusicXML.');
  }
  if (root.nodeName !== 'score-partwise') {
    throw new ImportError('This does not look like a MusicXML score.');
  }

  const warnings = new Set<string>();
  const title =
    text(path(root, 'work', 'work-title')) ?? text(child(root, 'movement-title')) ?? 'Untitled';
  let composer: string | undefined;
  const identification = child(root, 'identification');
  if (identification) {
    for (const c of elements(identification, 'creator')) {
      if (c.getAttribute('type') === 'composer') composer = text(c);
    }
  }

  const partNames = new Map<string, string>();
  const partList = child(root, 'part-list');
  if (partList) {
    for (const sp of elements(partList, 'score-part')) {
      partNames.set(sp.getAttribute('id') ?? '', text(child(sp, 'part-name')) ?? '');
    }
  }

  const measures: RawMeasure[] = [];
  const parts: PartInfo[] = [];
  const partEls = elements(root, 'part');
  if (partEls.length === 0) throw new ImportError('This score has no parts.');

  partEls.forEach((partEl, partIdx) => {
    const info: PartInfo = {
      name: partNames.get(partEl.getAttribute('id') ?? '') || `Part ${partIdx + 1}`,
      staves: 1,
      clefs: new Map(),
    };
    parts.push(info);
    let divisions = 1;
    let currentTime: { numerator: number; denominator: number } | undefined;

    elements(partEl, 'measure').forEach((mEl, mIdx) => {
      let raw = measures[mIdx];
      if (!raw) {
        raw = {
          number: mEl.getAttribute('number') ?? String(mIdx + 1),
          lengthBeats: 0,
          notes: [],
          tempos: [],
          forwardRepeat: false,
          backwardRepeat: false,
          repeatTimes: 2,
          endingStop: false,
        };
        measures[mIdx] = raw;
      }
      let pos = 0;
      let maxPos = 0;
      let lastOnset = 0;
      let noteIndex = 0;

      for (const el of elements(mEl)) {
        switch (el.nodeName) {
          case 'attributes': {
            const d = num(child(el, 'divisions'));
            if (d && d > 0) divisions = d;
            const key = child(el, 'key');
            const fifths = key ? num(child(key, 'fifths')) : undefined;
            if (fifths !== undefined && partIdx === 0) {
              const mode = text(child(key as Element, 'mode'));
              raw.key = {
                fifths,
                ...(mode === 'major' || mode === 'minor' ? { mode } : {}),
              };
            }
            const time = child(el, 'time');
            if (time && !child(time, 'senza-misura')) {
              const beats = (text(child(time, 'beats')) ?? '')
                .split('+')
                .reduce((sum, b) => sum + (Number(b) || 0), 0);
              const beatType = num(child(time, 'beat-type'));
              if (beats > 0 && beatType && beatType > 0) {
                currentTime = { numerator: beats, denominator: beatType };
                if (partIdx === 0) raw.time = currentTime;
              }
            }
            const staves = num(child(el, 'staves'));
            if (staves && staves > info.staves) info.staves = staves;
            for (const clef of elements(el, 'clef')) {
              const staff = Number(clef.getAttribute('number') ?? 1) || 1;
              const sign = text(child(clef, 'sign'));
              if (sign && !info.clefs.has(staff)) info.clefs.set(staff, sign);
            }
            break;
          }
          case 'note': {
            const index = noteIndex++;
            if (child(el, 'grace') || child(el, 'cue')) break;
            const dur = (num(child(el, 'duration')) ?? 0) / divisions;
            const isChord = child(el, 'chord') !== undefined;
            const onset = isChord ? lastOnset : pos;
            if (!isChord) {
              lastOnset = pos;
              pos += dur;
            }
            maxPos = Math.max(maxPos, pos, onset + dur);
            const pitchEl = child(el, 'pitch');
            if (!pitchEl || dur <= 0) break;
            const midi = stepToMidi(
              text(child(pitchEl, 'step')) ?? '',
              num(child(pitchEl, 'alter')) ?? 0,
              num(child(pitchEl, 'octave')) ?? Number.NaN,
            );
            if (midi === null || midi < 0 || midi > 127) break;
            const tieTypes = new Set<string>();
            for (const t of elements(el, 'tie')) tieTypes.add(t.getAttribute('type') ?? '');
            const notations = child(el, 'notations');
            if (notations) {
              for (const t of elements(notations, 'tied'))
                tieTypes.add(t.getAttribute('type') ?? '');
            }
            const fingering = notations
              ? num(path(notations, 'technical', 'fingering'))
              : undefined;
            raw.notes.push({
              part: partIdx,
              pitch: midi,
              posBeats: onset,
              durBeats: dur,
              staff: num(child(el, 'staff')) ?? 1,
              voice: num(child(el, 'voice')) ?? 1,
              tieStart: tieTypes.has('start'),
              tieStop: tieTypes.has('stop'),
              ...(fingering !== undefined && fingering >= 1 && fingering <= 5 ? { fingering } : {}),
              ref: `p${partIdx}-m${mIdx}-n${index}`,
            });
            break;
          }
          case 'backup':
            pos = Math.max(0, pos - (num(child(el, 'duration')) ?? 0) / divisions);
            break;
          case 'forward':
            pos += (num(child(el, 'duration')) ?? 0) / divisions;
            maxPos = Math.max(maxPos, pos);
            break;
          case 'direction': {
            const bpm = parseTempo(el);
            if (bpm !== undefined) raw.tempos.push({ posBeats: pos, bpm });
            const sound = child(el, 'sound');
            if (sound) noteJumps(sound, warnings);
            break;
          }
          case 'sound': {
            const bpm = Number(el.getAttribute('tempo') ?? NaN);
            if (Number.isFinite(bpm) && bpm > 0) raw.tempos.push({ posBeats: pos, bpm });
            noteJumps(el, warnings);
            break;
          }
          case 'barline': {
            const repeat = child(el, 'repeat');
            if (repeat) {
              const dir = repeat.getAttribute('direction');
              if (dir === 'forward') raw.forwardRepeat = true;
              if (dir === 'backward') {
                raw.backwardRepeat = true;
                const times = Number(repeat.getAttribute('times') ?? NaN);
                if (Number.isFinite(times) && times >= 2) raw.repeatTimes = times;
              }
            }
            const ending = child(el, 'ending');
            if (ending) {
              const type = ending.getAttribute('type');
              if (type === 'start')
                raw.endingStart = parseEndingNumbers(ending.getAttribute('number'));
              if (type === 'stop' || type === 'discontinue') raw.endingStop = true;
            }
            const sound = child(el, 'sound');
            if (sound) noteJumps(sound, warnings);
            break;
          }
          default:
            break;
        }
      }

      const expected = currentTime
        ? (currentTime.numerator * 4) / currentTime.denominator
        : undefined;
      const implicit = mEl.getAttribute('implicit') === 'yes';
      let length = maxPos;
      if (!implicit && expected !== undefined) length = Math.max(maxPos, expected);
      if (length <= 0) length = expected ?? 4;
      raw.lengthBeats = Math.max(raw.lengthBeats, length);
    });
  });

  return assemble({
    title,
    ...(composer ? { composer } : {}),
    format: options.format ?? 'musicxml',
    measures,
    parts,
    warnings,
  });
}

function noteJumps(sound: Element, warnings: Set<string>): void {
  for (const attr of ['dacapo', 'dalsegno', 'tocoda', 'fine']) {
    if (sound.getAttribute(attr)) {
      warnings.add(
        'This score uses D.C., D.S., coda or fine jumps. They are not followed yet; the music plays straight through.',
      );
    }
  }
}

// --- Assembly -----------------------------------------------------------------------------------

/** Playback order of source measures with simple repeats and numbered endings unrolled. */
export function playbackOrder(
  measures: readonly Pick<
    RawMeasure,
    'forwardRepeat' | 'backwardRepeat' | 'repeatTimes' | 'endingStart' | 'endingStop'
  >[],
): number[] {
  // Which ending numbers each measure belongs to (from an ending start through its stop).
  const endings: (number[] | undefined)[] = [];
  let open: number[] | undefined;
  measures.forEach((m, i) => {
    if (m.endingStart && m.endingStart.length > 0) open = m.endingStart;
    endings[i] = open;
    if (m.endingStop) open = undefined;
  });

  const order: number[] = [];
  const limit = measures.length * 8 + 8;
  let i = 0;
  let repeatStart = 0;
  let pass = 1;
  let jumped = false;
  while (i < measures.length && order.length < limit) {
    const m = measures[i];
    if (!m) break;
    if (m.forwardRepeat && !jumped) {
      repeatStart = i;
      pass = 1;
    }
    jumped = false;
    const inEnding = endings[i];
    if (inEnding && !inEnding.includes(pass)) {
      i += 1;
      continue;
    }
    order.push(i);
    if (m.backwardRepeat && pass < m.repeatTimes) {
      pass += 1;
      i = repeatStart;
      jumped = true;
      continue;
    }
    if (m.backwardRepeat) {
      pass = 1;
      repeatStart = i + 1;
    } else if (inEnding && m.endingStop && !m.backwardRepeat) {
      // Last ending of a repeated section: the section is done.
      pass = 1;
      repeatStart = i + 1;
    }
    i += 1;
  }
  return order;
}

interface AssembleInput {
  title: string;
  composer?: string;
  format: SongFormat;
  measures: RawMeasure[];
  parts: PartInfo[];
  warnings: Set<string>;
}

interface Draft extends Omit<SongNote, 'id' | 'hand'> {
  tieStart: boolean;
  tieStop: boolean;
}

function assemble(input: AssembleInput): Song {
  const order = playbackOrder(input.measures);
  const measures: Measure[] = [];
  const tempos: TempoEvent[] = [];
  const timeSignatures: TimeSignatureEvent[] = [];
  const keySignatures: KeySignatureEvent[] = [];
  const drafts: Draft[] = [];
  let beat = 0;
  let lastTime: string | undefined;
  let lastKey: string | undefined;

  order.forEach((src, index) => {
    const raw = input.measures[src];
    if (!raw) return;
    measures.push({
      index,
      number: raw.number,
      sourceIndex: src,
      startBeat: beat,
      lengthBeats: raw.lengthBeats,
    });
    if (raw.time) {
      const key = `${raw.time.numerator}/${raw.time.denominator}`;
      if (key !== lastTime) {
        timeSignatures.push({ beat, ...raw.time });
        lastTime = key;
      }
    }
    if (raw.key) {
      const key = `${raw.key.fifths}${raw.key.mode ?? ''}`;
      if (key !== lastKey) {
        keySignatures.push({ beat, ...raw.key });
        lastKey = key;
      }
    }
    for (const t of raw.tempos) {
      const prev = tempos[tempos.length - 1];
      if (!prev || prev.bpm !== t.bpm) tempos.push({ beat: beat + t.posBeats, bpm: t.bpm });
    }
    for (const n of raw.notes) {
      drafts.push({
        pitch: n.pitch,
        startBeat: beat + n.posBeats,
        durationBeats: n.durBeats,
        staff: n.staff,
        voice: n.voice,
        part: n.part,
        measureIndex: index,
        ...(n.fingering !== undefined ? { fingering: n.fingering } : {}),
        sourceRefs: [n.ref],
        tieStart: n.tieStart,
        tieStop: n.tieStop,
      });
    }
    beat += raw.lengthBeats;
  });

  if (tempos.length === 0 || (tempos[0]?.beat ?? 0) > 1e-9) {
    if (tempos.length === 0) {
      input.warnings.add(
        `This score has no tempo marking; ${DEFAULT_BPM} beats per minute is assumed.`,
      );
    }
    tempos.unshift({ beat: 0, bpm: tempos[0]?.bpm ?? DEFAULT_BPM });
  }

  const merged = mergeTies(drafts);
  const hands = handAssigner(input.parts, merged);
  const notes: SongNote[] = merged
    .map(({ tieStart: _a, tieStop: _b, ...n }) => ({ ...n, id: '', hand: hands(n) }))
    .sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch);
  notes.forEach((n, i) => (n.id = `n${i}`));

  if (notes.length === 0) input.warnings.add('This score contains no notes to play.');

  return {
    title: input.title,
    ...(input.composer ? { composer: input.composer } : {}),
    format: input.format,
    notes,
    measures,
    tempos,
    timeSignatures,
    keySignatures,
    parts: input.parts.map((p): Part => ({ name: p.name })),
    lengthBeats: beat,
    warnings: [...input.warnings],
  };
}

/** Merges tied notes (same part and pitch, contiguous) into single notes. */
function mergeTies(drafts: Draft[]): Draft[] {
  const sorted = [...drafts].sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch);
  const open = new Map<string, Draft>();
  const out: Draft[] = [];
  for (const n of sorted) {
    const key = `${n.part}:${n.pitch}`;
    const o = open.get(key);
    if (n.tieStop && o && Math.abs(o.startBeat + o.durationBeats - n.startBeat) < 1e-3) {
      o.durationBeats += n.durationBeats;
      o.sourceRefs.push(...n.sourceRefs);
      if (!n.tieStart) open.delete(key);
      continue;
    }
    out.push(n);
    if (n.tieStart) open.set(key, n);
    else open.delete(key);
  }
  return out;
}

/**
 * Hands from the score's layout: on a grand staff the upper staff is the right hand; separate
 * single-staff parts are split by average pitch; otherwise a bass clef means the left hand.
 */
function handAssigner(
  parts: PartInfo[],
  notes: Draft[],
): (n: { part: number; staff: number }) => Hand {
  const singleStaffParts = parts.length >= 2 && parts.every((p) => p.staves < 2);
  let leftPart = -1;
  if (singleStaffParts) {
    let lowest = Infinity;
    parts.forEach((_, i) => {
      const own = notes.filter((n) => n.part === i);
      if (own.length === 0) return;
      const avg = own.reduce((s, n) => s + n.pitch, 0) / own.length;
      if (avg < lowest) {
        lowest = avg;
        leftPart = i;
      }
    });
  }
  return (n) => {
    const part = parts[n.part];
    if (!part) return 'right';
    if (part.staves >= 2) return n.staff >= 2 ? 'left' : 'right';
    if (singleStaffParts) return n.part === leftPart ? 'left' : 'right';
    return part.clefs.get(n.staff) === 'F' ? 'left' : 'right';
  };
}
