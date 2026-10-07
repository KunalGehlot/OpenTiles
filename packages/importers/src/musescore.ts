// MuseScore files (.mscz, .mscx) → Song, read with our own code (ADR 0005: webmscore is
// GPL-2.0-only and cannot be combined with this AGPL-3.0 code base).
//
// Reads the MuseScore 3.x and 4.x formats (and the common parts of 2.x): parts and their staves,
// measures (with `len` for pickups and other irregular bars), voices, chords and rests from
// `durationType` and dots, notes from their MIDI `pitch`, fingering, tuplets (inline
// `Tuplet`…`endTuplet` and 2.x id references), time and key signatures, tempo marks, ties
// (`Spanner type="Tie"` and 2.x `Tie`/`endSpanner`), repeats (`startRepeat`/`endRepeat`) and
// voltas. A two-staff part (piano) gives the hands by staff. Everything runs on the device.
import { unzipSync } from 'fflate';
import {
  ImportError,
  assembleSong,
  baseName,
  decodeXml,
  isZip,
  parseEndingNumbers,
  parseXmlDocument,
  rawMeasure,
  xmlChild,
  xmlChildren,
  xmlNumber,
  xmlPath,
  xmlText,
} from '@opentiles/song-model';
import type { DomParserLike, RawMeasure, RawNote, RawPart, Song } from '@opentiles/song-model';

export interface MuseScoreOptions {
  domParser?: DomParserLike;
  /** Title used when the score has none (usually the file name). */
  fallbackTitle?: string;
}

const EPS = 1e-9;

const JUMP_WARNING =
  'This score uses D.C., D.S., coda or fine jumps. They are not followed yet; the music plays straight through.';

/** Quarter-note beats per `durationType`. */
const DURATION_BEATS: Record<string, number> = {
  long: 16,
  breve: 8,
  whole: 4,
  half: 2,
  quarter: 1,
  eighth: 0.5,
  '16th': 1 / 4,
  '32nd': 1 / 8,
  '64th': 1 / 16,
  '128th': 1 / 32,
  '256th': 1 / 64,
  '512th': 1 / 128,
  '1024th': 1 / 256,
};

/** Child elements that mark a chord as a grace note (which takes no time). */
const GRACE = new Set([
  'acciaccatura',
  'appoggiatura',
  'grace4',
  'grace16',
  'grace32',
  'grace8after',
  'grace16after',
  'grace32after',
]);

/** A MuseScore fraction such as `3/8` (of a whole note) in quarter-note beats. */
function fractionBeats(text: string | null | undefined): number | undefined {
  const m = /^\s*(-?\d+)\s*\/\s*(\d+)\s*$/.exec(text ?? '');
  if (!m) return undefined;
  const den = Number(m[2]);
  return den > 0 ? (Number(m[1]) / den) * 4 : undefined;
}

/** Returns the main .mscx text inside an .mscz file. */
export function unzipMscz(bytes: Uint8Array): string {
  let files: Record<string, Uint8Array>;
  try {
    // Thumbnails and audio are never needed; skip decompressing them.
    files = unzipSync(bytes, { filter: (f) => !/\.(png|jpe?g|ogg|mp3|wav|flac)$/i.test(f.name) });
  } catch {
    throw new ImportError('This .mscz file could not be unzipped.');
  }
  let rootPath: string | undefined;
  const container = files['META-INF/container.xml'];
  if (container) {
    for (const m of decodeXml(container).matchAll(/full-path\s*=\s*"([^"]+)"/gi)) {
      if (m[1] && /\.mscx$/i.test(m[1]) && files[m[1]]) {
        rootPath = m[1];
        break;
      }
    }
  }
  rootPath ??= Object.keys(files).find((n) => /\.mscx$/i.test(n) && !/^Excerpts\//i.test(n));
  const score = rootPath ? files[rootPath] : undefined;
  if (!score) throw new ImportError('No score was found inside this .mscz file.');
  return decodeXml(score);
}

interface StaffInfo {
  part: number;
  /** 1-based staff within the part. */
  staffInPart: number;
}

interface PartLayout {
  parts: RawPart[];
  staves: Map<string, StaffInfo | 'skip'>;
  skippedPercussion: boolean;
}

function firstLetter(clef: string | undefined): string | undefined {
  const c = clef?.trim()[0]?.toUpperCase();
  return c === 'G' || c === 'F' || c === 'C' ? c : undefined;
}

/** Parts, their staves and clefs, from the `Part` elements. Percussion parts are left out. */
function readParts(score: Element): PartLayout {
  const layout: PartLayout = { parts: [], staves: new Map(), skippedPercussion: false };
  xmlChildren(score, 'Part').forEach((partEl) => {
    const instrument = xmlChild(partEl, 'Instrument');
    const staffEls = xmlChildren(partEl, 'Staff');
    const percussion =
      xmlText(xmlChild(instrument, 'useDrumset')) === '1' ||
      staffEls.some((s) => xmlChild(s, 'StaffType')?.getAttribute('group') === 'percussion');
    if (percussion) {
      layout.skippedPercussion = true;
      for (const s of staffEls) layout.staves.set(s.getAttribute('id') ?? '', 'skip');
      return;
    }
    const part = layout.parts.length;
    const clefs = new Map<number, string>();
    staffEls.forEach((s, i) => {
      layout.staves.set(s.getAttribute('id') ?? String(layout.staves.size + 1), {
        part,
        staffInPart: i + 1,
      });
      const clef = firstLetter(xmlText(xmlChild(s, 'defaultClef')));
      if (clef) clefs.set(i + 1, clef);
    });
    if (instrument) {
      for (const c of xmlChildren(instrument, 'clef')) {
        const staff = Number(c.getAttribute('staff') ?? 1) || 1;
        const clef = firstLetter(xmlText(c));
        if (clef && !clefs.has(staff)) clefs.set(staff, clef);
      }
    }
    layout.parts.push({
      name:
        xmlText(xmlChild(partEl, 'trackName')) ??
        xmlText(xmlChild(instrument, 'longName')) ??
        xmlText(xmlChild(instrument, 'trackName')) ??
        `Part ${part + 1}`,
      staves: Math.max(1, staffEls.length),
      clefs,
    });
  });
  return layout;
}

/** Title or composer from the frame text above the music (`VBox`). */
function frameText(score: Element, style: string): string | undefined {
  for (const staff of xmlChildren(score, 'Staff')) {
    for (const box of xmlChildren(staff, 'VBox')) {
      for (const t of xmlChildren(box, 'Text')) {
        if (xmlText(xmlChild(t, 'style'))?.toLowerCase() === style) {
          const value = xmlText(xmlChild(t, 'text'))?.replace(/\s+/g, ' ');
          if (value) return value;
        }
      }
    }
  }
  return undefined;
}

/** Parses MuseScore XML (.mscx) into a Song. */
export function parseMscx(xml: string, options: MuseScoreOptions = {}): Song {
  const doc = parseXmlDocument(xml, options.domParser);
  const root = doc.documentElement;
  if (!root || root.nodeName !== 'museScore') {
    throw new ImportError('This does not look like a MuseScore file.');
  }
  const version = Number.parseFloat(root.getAttribute('version') ?? '');
  if (Number.isFinite(version) && version < 2) {
    throw new ImportError(
      'Files from MuseScore 1 are not supported. Open the file in a current MuseScore and save it again, or export it as MusicXML.',
    );
  }
  const score = xmlChild(root, 'Score');
  if (!score) throw new ImportError('This MuseScore file contains no score.');

  const warnings = new Set<string>();
  const meta = new Map<string, string>();
  for (const tag of xmlChildren(score, 'metaTag')) {
    const value = xmlText(tag);
    if (value) meta.set(tag.getAttribute('name') ?? '', value);
  }
  const title =
    meta.get('workTitle') ??
    meta.get('movementTitle') ??
    frameText(score, 'title') ??
    options.fallbackTitle ??
    'Untitled';
  const composer = meta.get('composer') ?? frameText(score, 'composer');
  const division = xmlNumber(xmlChild(score, 'Division')) ?? 480;

  const layout = readParts(score);
  const parts = layout.parts;
  if (layout.skippedPercussion) warnings.add('Percussion parts were left out.');

  const measures: RawMeasure[] = [];
  const sectionBreaks = new Set<number>();
  /** Measures excluded from the bar count (pickups, split bars). */
  const irregular = new Set<number>();
  const noteCounts = new Map<string, number>();
  /** Voltas by first and last measure; an open one (no end hook) may reach further. */
  const voltas: { start: number; end: number; open: boolean }[] = [];
  let primaryDone = false;

  for (const staffEl of xmlChildren(score, 'Staff')) {
    const id = staffEl.getAttribute('id') ?? '';
    let info = layout.staves.get(id);
    if (info === 'skip') continue;
    if (!info) {
      // A staff without a Part (unusual): give it a part of its own.
      info = { part: parts.length, staffInPart: 1 };
      parts.push({ name: `Part ${parts.length + 1}`, staves: 1, clefs: new Map() });
      layout.staves.set(id, info);
    }
    const { part, staffInPart } = info;
    const partInfo = parts[part] as RawPart;
    // Time and key signatures, voltas and other bar-level marks are read from the top staff.
    const primary = !primaryDone;
    primaryDone = true;
    let time = { numerator: 4, denominator: 4 };
    let measureStartTick = 0;
    const idTuplets = new Map<string, number>();
    const openVoltas = new Map<string, number>();

    xmlChildren(staffEl, 'Measure').forEach((mEl, mIdx) => {
      let raw = measures[mIdx];
      if (!raw) {
        raw = rawMeasure(mEl.getAttribute('number') ?? '');
        measures[mIdx] = raw;
      }
      if (xmlChild(mEl, 'startRepeat')) raw.forwardRepeat = true;
      if (primary && xmlChild(mEl, 'irregular')) irregular.add(mIdx);
      for (const lb of xmlChildren(mEl, 'LayoutBreak')) {
        // A section break: repeats after it never go back before it.
        if (xmlText(xmlChild(lb, 'subtype')) === 'section') sectionBreaks.add(mIdx);
      }
      const endRepeat = xmlChild(mEl, 'endRepeat');
      if (endRepeat) {
        raw.backwardRepeat = true;
        const times = xmlNumber(endRepeat);
        if (times !== undefined && times >= 2) raw.repeatTimes = times;
      }
      const len = fractionBeats(mEl.getAttribute('len'));
      const voiceEls = xmlChildren(mEl, 'voice');
      // MuseScore 2 has no <voice> elements: the measure holds the music directly.
      const containers = voiceEls.length > 0 ? voiceEls : [mEl];
      let maxPos = 0;

      containers.forEach((container, v) => {
        let pos = 0;
        let voice = v;
        const tupletStack: number[] = [];
        for (const el of xmlChildren(container)) {
          switch (el.nodeName) {
            case 'TimeSig': {
              const n = xmlNumber(xmlChild(el, 'sigN'));
              const d = xmlNumber(xmlChild(el, 'sigD'));
              if (n && d && n > 0 && d > 0) {
                time = { numerator: n, denominator: d };
                if (primary) raw.time = time;
              }
              break;
            }
            case 'KeySig': {
              if (!primary) break;
              const fifths =
                xmlNumber(xmlChild(el, 'concertKey')) ??
                xmlNumber(xmlChild(el, 'accidental')) ??
                xmlNumber(xmlChild(el, 'actualKey')) ??
                0;
              const mode = xmlText(xmlChild(el, 'mode'));
              raw.key = {
                fifths: Math.max(-7, Math.min(7, fifths)),
                ...(mode === 'major' || mode === 'minor' ? { mode } : {}),
              };
              break;
            }
            case 'Tempo': {
              const perSecond = xmlNumber(xmlChild(el, 'tempo'));
              if (perSecond && perSecond > 0) {
                raw.tempos.push({ posBeats: pos, bpm: Math.round(perSecond * 60 * 100) / 100 });
              }
              break;
            }
            case 'Clef': {
              if (pos > EPS || mIdx > 0) break;
              const clef = firstLetter(
                xmlText(xmlChild(el, 'concertClefType')) ?? xmlText(xmlChild(el, 'subtype')),
              );
              if (clef && !partInfo.clefs.has(staffInPart)) partInfo.clefs.set(staffInPart, clef);
              break;
            }
            case 'location':
              pos = Math.max(0, pos + (fractionBeats(xmlText(xmlChild(el, 'fractions'))) ?? 0));
              break;
            case 'tick': {
              // MuseScore 2: absolute position in ticks.
              const tick = xmlNumber(el);
              if (tick !== undefined) pos = Math.max(0, (tick - measureStartTick) / division);
              break;
            }
            case 'Tuplet': {
              const normal = xmlNumber(xmlChild(el, 'normalNotes'));
              const actual = xmlNumber(xmlChild(el, 'actualNotes'));
              let ratio = normal && actual && normal > 0 && actual > 0 ? normal / actual : 1;
              const tupletId = el.getAttribute('id');
              if (tupletId !== null) {
                // MuseScore 2: defined once, referenced from each chord; may nest by reference.
                const parent = xmlText(xmlChild(el, 'Tuplet'));
                if (parent !== undefined) ratio *= idTuplets.get(parent) ?? 1;
                idTuplets.set(tupletId, ratio);
              } else {
                tupletStack.push(ratio);
              }
              break;
            }
            case 'endTuplet':
              tupletStack.pop();
              break;
            case 'Spanner': {
              if (el.getAttribute('type') !== 'Volta') break;
              const volta = xmlChild(el, 'Volta');
              const numbers = parseEndingNumbers(xmlText(xmlChild(volta, 'endings')));
              if (!volta || numbers.length === 0) break;
              raw.endingStart = numbers;
              const location = xmlPath(el, 'next', 'location');
              let span = xmlNumber(xmlChild(location, 'measures')) ?? 0;
              if ((fractionBeats(xmlText(xmlChild(location, 'fractions'))) ?? 0) > EPS) span += 1;
              voltas.push({
                start: mIdx,
                end: mIdx + Math.max(1, span) - 1,
                open: (xmlNumber(xmlChild(volta, 'endHookType')) ?? 0) === 0,
              });
              break;
            }
            case 'Volta': {
              // MuseScore 2 volta: closed later by an endSpanner with the same id.
              const numbers = parseEndingNumbers(xmlText(xmlChild(el, 'endings')));
              if (numbers.length === 0) break;
              raw.endingStart = numbers;
              openVoltas.set(el.getAttribute('id') ?? '', mIdx);
              break;
            }
            case 'endSpanner': {
              const spannerId = el.getAttribute('id') ?? '';
              const start = openVoltas.get(spannerId);
              if (start !== undefined) {
                voltas.push({
                  start,
                  end: Math.max(start, pos <= EPS ? mIdx - 1 : mIdx),
                  open: false,
                });
                openVoltas.delete(spannerId);
              }
              break;
            }
            case 'Jump':
              warnings.add(JUMP_WARNING);
              break;
            case 'Chord':
            case 'Rest': {
              if (xmlChildren(el).some((c) => GRACE.has(c.nodeName))) break;
              const track = xmlNumber(xmlChild(el, 'track'));
              if (track !== undefined) voice = track % 4;
              const type = xmlText(xmlChild(el, 'durationType'));
              let dur: number;
              if (type === 'measure') {
                dur =
                  fractionBeats(xmlText(xmlChild(el, 'duration'))) ??
                  len ??
                  (time.numerator * 4) / time.denominator;
              } else {
                const base =
                  DURATION_BEATS[type ?? ''] ?? fractionBeats(xmlText(xmlChild(el, 'duration')));
                if (base === undefined) break;
                const dots = Math.max(0, Math.min(4, xmlNumber(xmlChild(el, 'dots')) ?? 0));
                dur = base * (2 - 1 / 2 ** dots);
                const ref = xmlText(xmlChild(el, 'Tuplet'));
                if (ref !== undefined && idTuplets.has(ref)) dur *= idTuplets.get(ref) ?? 1;
                else for (const r of tupletStack) dur *= r;
              }
              if (el.nodeName === 'Chord') {
                for (const noteEl of xmlChildren(el, 'Note')) {
                  const note = readNote(noteEl);
                  if (!note) continue;
                  const key = `${part}:${mIdx}`;
                  const index = noteCounts.get(key) ?? 0;
                  noteCounts.set(key, index + 1);
                  raw.notes.push({
                    part,
                    pitch: note.pitch,
                    posBeats: pos,
                    durBeats: dur,
                    staff: staffInPart,
                    voice: (staffInPart - 1) * 4 + voice + 1,
                    tieStart: note.tieStart,
                    tieStop: note.tieStop,
                    ...(note.fingering !== undefined ? { fingering: note.fingering } : {}),
                    ref: `p${part}-m${mIdx}-n${index}`,
                  } satisfies RawNote);
                }
              }
              pos += dur;
              maxPos = Math.max(maxPos, pos);
              break;
            }
            default:
              break;
          }
        }
      });
      if (xmlChild(mEl, 'Jump')) warnings.add(JUMP_WARNING);

      const nominal = len ?? (time.numerator * 4) / time.denominator;
      const length = Math.max(nominal, maxPos);
      raw.lengthBeats = Math.max(raw.lengthBeats, length);
      measureStartTick += length * division;
    });
  }

  if (measures.length === 0) throw new ImportError('This MuseScore file contains no music.');
  for (const b of sectionBreaks) {
    const next = measures[b + 1];
    if (next) next.sectionStart = true;
  }
  // As in MuseScore, an open volta line reaches to the next end repeat, unless another volta or
  // repeated section starts first.
  const voltaStarts = new Set(voltas.map((v) => v.start));
  for (const v of voltas) {
    let end = Math.min(v.end, measures.length - 1);
    if (v.open && !measures[end]?.backwardRepeat) {
      for (let j = end + 1; j < measures.length; j++) {
        const m = measures[j] as RawMeasure;
        if (voltaStarts.has(j) || m.forwardRepeat || m.sectionStart) break;
        if (m.backwardRepeat) {
          end = j;
          break;
        }
      }
    }
    const last = measures[end];
    if (last) last.endingStop = true;
  }
  const first = measures[0] as RawMeasure;
  // MuseScore writes no key signature for C major / A minor.
  first.key ??= { fifths: 0 };
  // Bar numbers: MuseScore 2 writes them. Otherwise count them like MuseScore: from 1 in each
  // section, leaving out bars excluded from the count and a short first bar (pickup, bar 0).
  const nominalFirst = first.time ? (first.time.numerator * 4) / first.time.denominator : 4;
  const pickup = measures.length > 1 && first.lengthBeats < nominalFirst - EPS;
  let counter = 0;
  measures.forEach((m, i) => {
    if (m.sectionStart) counter = 0;
    if (!irregular.has(i) && !(i === 0 && pickup)) counter += 1;
    if (!m.number) m.number = String(counter);
  });

  return assembleSong({
    title,
    ...(composer ? { composer } : {}),
    format: 'mscz',
    measures,
    parts,
    warnings,
    repeatFrom: 'lastForwardRepeat',
  });
}

interface NoteData {
  pitch: number;
  tieStart: boolean;
  tieStop: boolean;
  fingering?: number;
}

function readNote(noteEl: Element): NoteData | undefined {
  const pitch = xmlNumber(xmlChild(noteEl, 'pitch'));
  if (pitch === undefined || pitch < 0 || pitch > 127) return undefined;
  let tieStart = false;
  let tieStop = false;
  for (const el of xmlChildren(noteEl)) {
    if (el.nodeName === 'Spanner' && el.getAttribute('type') === 'Tie') {
      if (xmlChild(el, 'next')) tieStart = true;
      if (xmlChild(el, 'prev')) tieStop = true;
    } else if (el.nodeName === 'Tie') {
      tieStart = true; // MuseScore 2
    } else if (el.nodeName === 'endSpanner') {
      tieStop = true; // MuseScore 2
    }
  }
  let fingering: number | undefined;
  for (const f of xmlChildren(noteEl, 'Fingering')) {
    const value = Number(xmlText(xmlChild(f, 'text')) ?? xmlText(f));
    if (Number.isInteger(value) && value >= 1 && value <= 5) {
      fingering = value;
      break;
    }
  }
  return { pitch, tieStart, tieStop, ...(fingering !== undefined ? { fingering } : {}) };
}

/** Reads an .mscz or .mscx file. */
export function readMuseScore(
  fileName: string,
  bytes: Uint8Array,
  options: { domParser?: DomParserLike } = {},
): Song {
  const xml = isZip(bytes) ? unzipMscz(bytes) : decodeXml(bytes);
  return parseMscx(xml, {
    ...(options.domParser ? { domParser: options.domParser } : {}),
    fallbackTitle: baseName(fileName),
  });
}
