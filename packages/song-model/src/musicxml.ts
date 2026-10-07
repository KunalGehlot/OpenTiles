// MusicXML (partwise) → Song. Runs in the browser with the global DOMParser; tests and workers
// can pass any DOMParser-compatible implementation.
import { assembleSong, parseEndingNumbers, rawMeasure } from './builder';
import type { RawMeasure, RawPart } from './builder';
import { ImportError } from './errors';
import { stepToMidi } from './pitch';
import type { Song, SongFormat } from './types';
import {
  parseXmlDocument,
  xmlChild as child,
  xmlChildren as elements,
  xmlNumber as num,
  xmlPath as path,
  xmlText as text,
} from './xml';
import type { DomParserLike } from './xml';

export { ImportError } from './errors';
export { playbackOrder } from './builder';
export type { DomParserLike } from './xml';

export interface MusicXmlOptions {
  domParser?: DomParserLike;
  /** Recorded on the song; `mxl` when the XML came out of a compressed file. */
  format?: SongFormat;
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

export function parseMusicXml(xml: string, options: MusicXmlOptions = {}): Song {
  const doc = parseXmlDocument(xml, options.domParser);
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
  const parts: RawPart[] = [];
  const partEls = elements(root, 'part');
  if (partEls.length === 0) throw new ImportError('This score has no parts.');

  partEls.forEach((partEl, partIdx) => {
    const info: RawPart = {
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
        raw = rawMeasure(mEl.getAttribute('number') ?? String(mIdx + 1));
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

  return assembleSong({
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
