// Dynamics marks and hairpins from notation (P6-16, ADR 0025). A score says how loud with marks
// (p, mf, ff), hairpins and "cresc." between them, and sudden accents (sf, fp). The importer turns
// them into each note's velocity, the field a MIDI file fills from its own touch, so the Player and
// the practice sound follow them without a second loudness model. A score's velocities are its
// marks, not a performance: playback still shapes the touch around them (`isNotated`).
import type { SongFormat } from './types';

const EPS = 1e-6;

/** A mark's velocity: MuseScore's playback values, so a file plays as it did where it was written. */
export const DYNAMIC_VELOCITIES: Readonly<Record<string, number>> = {
  pppppp: 1,
  ppppp: 5,
  pppp: 10,
  ppp: 16,
  pp: 33,
  p: 49,
  mp: 64,
  mf: 80,
  f: 96,
  ff: 112,
  fff: 126,
  ffff: 127,
  fffff: 127,
  ffffff: 127,
};

/** The loudness before a score's first mark, and of a score with none: mezzo-forte. */
export const UNMARKED_VELOCITY = 80;

/** A sudden accent (sf, sfz, fz) is this much louder than the music around it. */
const SFORZANDO_LIFT = 32;
/** A mark this soon after a hairpin's end is where the hairpin was going. */
const TARGET_REACH = 1;
/** One step on the ladder, for a hairpin that ends without a mark. */
const LADDER = [16, 33, 49, 64, 80, 96, 112, 126];

/** Accents by mark name: `level` is the loudness after the accented notes (fp: forte, then piano). */
const ACCENTS: Readonly<Record<string, { onset?: number; sforzando?: true; level?: number }>> = {
  sf: { sforzando: true },
  sfz: { sforzando: true },
  sffz: { sforzando: true },
  fz: { sforzando: true },
  rf: { sforzando: true },
  rfz: { sforzando: true },
  fp: { onset: 96, level: 49 },
  sfp: { sforzando: true, level: 49 },
  sfpp: { sforzando: true, level: 33 },
};

/** One dynamics mark as an importer reads it, in beats from the start of its source measure. */
export interface RawDynamic {
  posBeats: number;
  /** 0-based part. */
  part: number;
  /** The staff the mark is written for; without one it is for the whole part. */
  staff?: number;
  /** The velocity from here on (p, mf, a `<sound dynamics>`). */
  level?: number;
  /** The velocity of the notes that start exactly here (fp). */
  onset?: number;
  /** The notes that start here are accented over the music around them (sf, sfz). */
  sforzando?: boolean;
  /** A hairpin or a "cresc." / "dim." starts, or a hairpin ends. */
  wedge?: 'crescendo' | 'diminuendo' | 'stop';
}

/** A mark on the song's beat axis, after repeats are unrolled. */
export interface DynamicEvent extends Omit<RawDynamic, 'posBeats'> {
  beat: number;
}

/** What `applyDynamics` needs of a note; it sets `velocity`. */
export interface DynamicNote {
  startBeat: number;
  part: number;
  staff: number;
  velocity?: number;
}

/** Formats written as notation: their velocities, if any, come from marks, not from a pianist. */
export function isNotated(format: SongFormat): boolean {
  return format === 'musicxml' || format === 'mxl' || format === 'abc' || format === 'mscz';
}

/** The mark a `<dynamics>` element names (its first child the ladder or the accents know). */
export function dynamicFromName(
  name: string,
): Pick<RawDynamic, 'level' | 'onset' | 'sforzando'> | undefined {
  // Own keys only: an element called "constructor" is not a mark.
  if (Object.hasOwn(DYNAMIC_VELOCITIES, name)) return { level: DYNAMIC_VELOCITIES[name] as number };
  return Object.hasOwn(ACCENTS, name) ? { ...ACCENTS[name] } : undefined;
}

function clampVelocity(v: number): number {
  return Math.max(1, Math.min(127, Math.round(v)));
}

/** One step louder or softer on the ladder. */
function stepFrom(level: number, dir: 'crescendo' | 'diminuendo'): number {
  if (dir === 'crescendo') return LADDER.find((l) => l > level + 2) ?? Math.min(127, level + 12);
  return [...LADDER].reverse().find((l) => l < level - 2) ?? Math.max(1, level - 12);
}

interface Ramp {
  from: number;
  to: number;
  fromLevel: number;
  toLevel: number;
}

/** The loudness along one staff (or part), from the marks that apply to it, sorted by beat. */
function loudness(events: DynamicEvent[]): {
  at: (beat: number) => number;
  before: (beat: number) => number;
} {
  const marks = events
    .filter((e) => e.level !== undefined)
    .map((e) => ({ beat: e.beat, level: e.level as number }));
  const markAt = (beat: number, strict: boolean): number => {
    let level = UNMARKED_VELOCITY;
    for (const m of marks) {
      if (strict ? m.beat < beat - EPS : m.beat <= beat + EPS) level = m.level;
      else break;
    }
    return level;
  };
  const ramps: Ramp[] = [];
  const starts = events.filter((e) => e.wedge === 'crescendo' || e.wedge === 'diminuendo');
  starts.forEach((start, i) => {
    const dir = start.wedge as 'crescendo' | 'diminuendo';
    const nextStart = starts[i + 1]?.beat ?? Infinity;
    const stop = events.find(
      (e) => e.wedge === 'stop' && e.beat > start.beat + EPS && e.beat <= nextStart + EPS,
    );
    const nextMark = marks.find((m) => m.beat > start.beat + EPS);
    // A hairpin ends at its stop; a "cresc." without one runs to the next mark.
    const end =
      stop?.beat ?? (nextMark && nextMark.beat <= nextStart + EPS ? nextMark.beat : undefined);
    if (end === undefined) return;
    const fromLevel = markAt(start.beat, false);
    const target = nextMark && nextMark.beat <= end + TARGET_REACH + EPS ? nextMark : undefined;
    // With a goal it grows until the goal; without one, until its end.
    const to = target ? target.beat : end;
    if (to <= start.beat + EPS) return;
    const toLevel = target ? target.level : stepFrom(fromLevel, dir);
    ramps.push({ from: start.beat, to, fromLevel, toLevel });
    // Without a mark at its end, the music stays where the hairpin took it.
    if (!target) {
      const at = marks.findIndex((m) => m.beat > to + EPS);
      marks.splice(at < 0 ? marks.length : at, 0, { beat: to, level: toLevel });
    }
  });
  const at = (beat: number, strict: boolean): number => {
    for (const r of ramps) {
      if (beat >= r.from - EPS && beat < r.to - EPS) {
        return r.fromLevel + ((r.toLevel - r.fromLevel) * (beat - r.from)) / (r.to - r.from);
      }
    }
    return markAt(beat, strict);
  };
  return { at: (beat) => at(beat, false), before: (beat) => at(beat, true) };
}

/**
 * Sets each note's velocity from the marks of its part. A mark written for one staff is for that
 * staff (each hand of a grand staff can have its own); a staff with no marks of its own follows
 * every mark of its part, as a piano's single line of marks between the staves does. A part with
 * no marks is left alone (mezzo-forte when played).
 */
export function applyDynamics(notes: DynamicNote[], events: DynamicEvent[]): void {
  if (events.length === 0) return;
  const sorted = [...events].sort((a, b) => a.beat - b.beat);
  const scopes = new Map<string, ReturnType<typeof loudness> & { accents: DynamicEvent[] }>();
  const scopeFor = (part: number, staff: number) => {
    const key = `${part}:${staff}`;
    let scope = scopes.get(key);
    if (!scope) {
      const ofPart = sorted.filter((e) => e.part === part);
      // A staff has marks of its own when a level or an accent names it; a hairpin alone does not
      // make the part's p and f someone else's.
      const own = ofPart.some(
        (e) => e.staff === staff && (e.level !== undefined || e.onset !== undefined || e.sforzando),
      );
      const mine = ofPart.filter((e) => !own || e.staff === undefined || e.staff === staff);
      scope = {
        ...loudness(mine),
        accents: mine.filter((e) => e.onset !== undefined || e.sforzando),
      };
      scopes.set(key, scope);
    }
    return scope;
  };
  const marked = new Set(sorted.map((e) => e.part));
  for (const n of notes) {
    if (!marked.has(n.part)) continue;
    const scope = scopeFor(n.part, n.staff);
    let v = scope.at(n.startBeat);
    const accent = scope.accents.find((e) => Math.abs(e.beat - n.startBeat) < EPS);
    if (accent?.onset !== undefined) v = accent.onset;
    else if (accent?.sforzando) v = scope.before(n.startBeat) + SFORZANDO_LIFT;
    n.velocity = clampVelocity(v);
  }
}
