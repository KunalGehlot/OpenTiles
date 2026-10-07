// MuseScore test files generated in code (self-made, CC0). No third-party scores in tests.
import { DOMParser } from '@xmldom/xmldom';
import type { DomParserLike } from '@opentiles/song-model';

export const domParser = new DOMParser() as unknown as DomParserLike;

export interface MsNote {
  pitch: number;
  /** MuseScore 3/4 tie spanners: `start` ties into the next note, `stop` ends a tie. */
  tie?: 'start' | 'stop' | 'both';
  fingering?: number;
}

const tieStart =
  '<Spanner type="Tie"><Tie/><next><location><fractions>1/4</fractions></location></next></Spanner>';
const tieStop =
  '<Spanner type="Tie"><prev><location><fractions>-1/4</fractions></location></prev></Spanner>';

export function msNote(n: MsNote): string {
  const ties =
    (n.tie === 'start' || n.tie === 'both' ? tieStart : '') +
    (n.tie === 'stop' || n.tie === 'both' ? tieStop : '');
  const fingering = n.fingering ? `<Fingering><text>${n.fingering}</text></Fingering>` : '';
  return `<Note>${fingering}${ties}<pitch>${n.pitch}</pitch><tpc>14</tpc></Note>`;
}

export interface ChordOptions {
  dots?: number;
  grace?: string;
  /** MuseScore 2 tuplet reference. */
  tuplet?: string;
}

export function chord(type: string, notes: (number | MsNote)[], o: ChordOptions = {}): string {
  return `<Chord>${o.grace ? `<${o.grace}/>` : ''}${o.tuplet ? `<Tuplet>${o.tuplet}</Tuplet>` : ''}${
    o.dots ? `<dots>${o.dots}</dots>` : ''
  }<durationType>${type}</durationType>${notes
    .map((n) => msNote(typeof n === 'number' ? { pitch: n } : n))
    .join('')}</Chord>`;
}

export const rest = (type: string, duration?: string) =>
  `<Rest><durationType>${type}</durationType>${duration ? `<duration>${duration}</duration>` : ''}</Rest>`;

export const timeSig = (n: number, d: number) =>
  `<TimeSig><sigN>${n}</sigN><sigD>${d}</sigD></TimeSig>`;

/** `tempo` in quarter notes per second, as MuseScore stores it. */
export const tempoMark = (bpm: number) =>
  `<Tempo><tempo>${(bpm / 60).toFixed(6)}</tempo><followText>1</followText><text>♩ = ${bpm}</text></Tempo>`;

export const keySig3 = (fifths: number) => `<KeySig><accidental>${fifths}</accidental></KeySig>`;
export const keySig4 = (fifths: number) => `<KeySig><concertKey>${fifths}</concertKey></KeySig>`;

export const tuplet = (actual: number, normal: number, base = 'eighth') =>
  `<Tuplet><normalNotes>${normal}</normalNotes><actualNotes>${actual}</actualNotes><baseNote>${base}</baseNote><Number><style>tuplet</style><text>${actual}</text></Number></Tuplet>`;

/** A volta over `measures` bars; an open one has no end hook. */
export const volta = (endings: string, measures = 1, open = false) =>
  `<Spanner type="Volta"><Volta>${open ? '' : '<endHookType>1</endHookType>'}<beginText>${endings}.</beginText><endings>${endings}</endings></Volta><next><location><measures>${measures}</measures></location></next></Spanner>`;

export const voltaEnd = (measures = 1) =>
  `<Spanner type="Volta"><prev><location><measures>-${measures}</measures></location></prev></Spanner>`;

export interface MsMeasure {
  voices: string[];
  len?: string;
  startRepeat?: boolean;
  endRepeat?: number;
  extra?: string;
}

export function measure(m: MsMeasure): string {
  return `<Measure${m.len ? ` len="${m.len}"` : ''}>${m.startRepeat ? '<startRepeat/>' : ''}${
    m.endRepeat ? `<endRepeat>${m.endRepeat}</endRepeat>` : ''
  }${m.extra ?? ''}${m.voices.map((v) => `<voice>${v}</voice>`).join('')}</Measure>`;
}

export interface MsPart {
  name?: string;
  staves: number[];
  /** `defaultClef` per staff index (0-based). */
  clefs?: (string | undefined)[];
  drums?: boolean;
}

export function part(p: MsPart): string {
  const staves = p.staves
    .map(
      (id, i) =>
        `<Staff id="${id}"><StaffType group="${p.drums ? 'percussion' : 'pitched'}"><name>stdNormal</name></StaffType>${
          p.clefs?.[i] ? `<defaultClef>${p.clefs[i]}</defaultClef>` : ''
        }</Staff>`,
    )
    .join('');
  return `<Part>${staves}<trackName>${p.name ?? 'Piano'}</trackName><Instrument><longName>${
    p.name ?? 'Piano'
  }</longName><trackName>${p.name ?? 'Piano'}</trackName>${p.drums ? '<useDrumset>1</useDrumset>' : ''}<Channel><program value="0"/></Channel></Instrument></Part>`;
}

export interface MsScore {
  version?: string;
  meta?: Record<string, string>;
  /** Text frame above the music: `[style, text]` pairs. */
  frame?: [string, string][];
  parts: MsPart[];
  /** Measures per staff id. */
  staves: Record<number, string[]>;
}

export function mscx(s: MsScore): string {
  const meta = Object.entries(s.meta ?? {})
    .map(([k, v]) => `<metaTag name="${k}">${v}</metaTag>`)
    .join('');
  const frame = s.frame
    ? `<VBox><height>10</height>${s.frame
        .map(([style, text]) => `<Text><style>${style}</style><text>${text}</text></Text>`)
        .join('')}</VBox>`
    : '';
  const staves = Object.entries(s.staves)
    .map(([id, ms], i) => `<Staff id="${id}">${i === 0 ? frame : ''}${ms.join('')}</Staff>`)
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<museScore version="${s.version ?? '3.02'}"><programVersion>${s.version?.startsWith('4') ? '4.2.1' : '3.6.2'}</programVersion><Score><Division>480</Division>${meta}${s.parts
    .map(part)
    .join('')}${staves}</Score></museScore>`;
}
