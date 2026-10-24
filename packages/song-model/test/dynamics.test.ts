// Dynamics marks and hairpins from MusicXML (P6-16, ADR 0025). Scores generated in code (CC0).
import { describe, expect, it } from 'vitest';
import { applyDynamics, isNotated, UNMARKED_VELOCITY } from '../src/dynamics';
import { parseMusicXml } from '../src/musicxml';
import { attrs, domParser, note, score } from './fixtures';

const parse = (xml: string) => parseMusicXml(xml, { domParser });
const q = (step: string, octave: number, extra: Partial<Parameters<typeof note>[0]> = {}) =>
  note({ step, octave, duration: 1, ...extra });
const four = attrs({ divisions: 1, fifths: 0, beats: 4 });
const staffEl = (staff?: number) => (staff ? `<staff>${staff}</staff>` : '');
const dyn = (mark: string, staff?: number, sound?: number) =>
  `<direction placement="below"><direction-type><dynamics><${mark}/></dynamics></direction-type>${staffEl(staff)}${
    sound === undefined ? '' : `<sound dynamics="${sound}"/>`
  }</direction>`;
const wedge = (type: string) =>
  `<direction placement="below"><direction-type><wedge type="${type}"/></direction-type></direction>`;
const words = (said: string) =>
  `<direction placement="below"><direction-type><words>${said}</words></direction-type></direction>`;
const velocities = (xml: string) => parse(xml).notes.map((n) => n.velocity);
const oneBar = (content: string) => score([[{ attributes: four, content }]]);
const bars = (...contents: string[]) =>
  score([contents.map((content, i) => (i === 0 ? { attributes: four, content } : { content }))]);

describe('dynamics marks (P6-16)', () => {
  it('sets each note’s velocity from the last mark, with MuseScore’s values', () => {
    expect(
      velocities(oneBar(dyn('p') + q('C', 4) + q('D', 4) + dyn('ff') + q('E', 4) + q('F', 4))),
    ).toEqual([49, 49, 112, 112]);
  });

  it('plays notes before the first mark at mezzo-forte, and leaves a score without marks alone', () => {
    expect(velocities(oneBar(q('C', 4) + dyn('pp') + q('D', 4)))).toEqual([UNMARKED_VELOCITY, 33]);
    expect(velocities(oneBar(q('C', 4) + q('D', 4)))).toEqual([undefined, undefined]);
  });

  it('takes how loud a mark plays from its sound, a percentage of forte at 90', () => {
    expect(velocities(oneBar(dyn('p', undefined, 60) + q('C', 4)))).toEqual([54]);
    // A sound on its own sets the level too.
    expect(velocities(oneBar('<sound dynamics="100"/>' + q('C', 4)))).toEqual([90]);
  });

  it('accents the notes under sf and fp, then goes back or down', () => {
    expect(velocities(oneBar(dyn('p') + q('C', 4) + dyn('sfz') + q('D', 4) + q('E', 4)))).toEqual([
      49, 81, 49,
    ]);
    expect(velocities(oneBar(dyn('fp') + q('C', 4) + q('D', 4)))).toEqual([96, 49]);
    expect(velocities(oneBar(dyn('mf') + q('C', 4) + dyn('sfp') + q('D', 4) + q('E', 4)))).toEqual([
      80, 112, 49,
    ]);
  });

  it('keeps a tied note at the loudness it started with', () => {
    const song = parse(
      bars(
        dyn('p') + q('C', 4, { duration: 4, tie: ['start'] }),
        dyn('f') + q('C', 4, { duration: 1, tie: ['stop'] }) + q('D', 4, { duration: 3 }),
      ),
    );
    expect(song.notes.map((n) => [n.durationBeats, n.velocity])).toEqual([
      [5, 49],
      [3, 96],
    ]);
  });

  it('repeats a repeated bar’s marks', () => {
    const song = parse(
      score([
        [
          { attributes: four, content: dyn('p') + q('C', 4, { duration: 4 }) },
          {
            content: dyn('f') + q('D', 4, { duration: 4 }),
            right: '<repeat direction="backward"/>',
          },
        ],
      ]),
    );
    expect(song.notes.map((n) => n.velocity)).toEqual([49, 96, 49, 96]);
  });
});

describe('hairpins (P6-16)', () => {
  it('grows from one mark to the next, note by note', () => {
    const v = velocities(
      bars(
        dyn('p') +
          wedge('crescendo') +
          q('C', 4) +
          q('D', 4) +
          q('E', 4) +
          q('F', 4) +
          wedge('stop'),
        dyn('f') + q('G', 4, { duration: 4 }),
      ),
    );
    expect(v).toEqual([49, 61, 73, 84, 96]);
  });

  it('takes a mark at or a little after the hairpin’s end as its goal', () => {
    // The hairpin stops after beat 2, a rest, and the pp comes on beat 3.
    const rest = '<forward><duration>1</duration></forward>';
    const v = velocities(
      oneBar(
        dyn('p') +
          wedge('diminuendo') +
          q('C', 4) +
          q('D', 4) +
          wedge('stop') +
          rest +
          dyn('pp') +
          q('E', 4),
      ),
    );
    expect(v).toEqual([49, 44, 33]);
    const aimed = velocities(
      oneBar(
        dyn('p') +
          wedge('diminuendo') +
          q('C', 4) +
          q('D', 4) +
          wedge('stop') +
          dyn('pp') +
          q('E', 4),
      ),
    );
    expect(aimed).toEqual([49, 41, 33]);
  });

  it('without a mark at its end, moves one step and stays there', () => {
    expect(
      velocities(
        oneBar(dyn('mp') + wedge('crescendo') + q('C', 4) + q('D', 4) + wedge('stop') + q('E', 4)),
      ),
    ).toEqual([64, 72, 80]);
    const v = velocities(
      oneBar(
        dyn('f') +
          wedge('diminuendo') +
          q('C', 4) +
          q('D', 4) +
          wedge('stop') +
          q('E', 4) +
          q('F', 4),
      ),
    );
    expect(v).toEqual([96, 88, 80, 80]);
  });

  it('reads "cresc." and "dim." as hairpins that run to the next mark', () => {
    const v = velocities(
      oneBar(dyn('p') + words('cresc.') + q('C', 4) + q('D', 4) + q('E', 4) + dyn('f') + q('F', 4)),
    );
    expect(v).toEqual([49, 65, 80, 96]);
    const dim = velocities(
      oneBar(dyn('f') + words('dim.') + q('C', 4) + q('D', 4) + dyn('p') + q('E', 4)),
    );
    expect(dim).toEqual([96, 73, 49]);
  });

  it('spreads many velocities over a melody, and the score still says it is notation', () => {
    const song = parse(
      bars(
        dyn('pp') + wedge('crescendo') + q('C', 4) + q('D', 4) + q('E', 4) + q('F', 4),
        q('G', 4) + q('A', 4) + q('B', 4) + q('C', 5) + wedge('stop'),
        dyn('ff') + q('C', 6, { duration: 4 }),
      ),
    );
    const levels = new Set(song.notes.map((n) => n.velocity));
    expect(levels.size).toBeGreaterThan(8);
    expect(isNotated(song.format)).toBe(true);
  });
});

describe('which marks a staff follows (P6-16)', () => {
  const grand = attrs({ divisions: 1, fifths: 0, beats: 4, staves: 2 });
  const rh = (step: string) => q(step, 5, { staff: 1 });
  const lh = (step: string) => q(step, 3, { staff: 2, voice: 5 });
  const back = '<backup><duration>2</duration></backup>';

  it('one line of marks between the staves is for both hands', () => {
    const song = parse(
      score([
        [
          {
            attributes: grand,
            content: dyn('p', 1) + rh('C') + rh('D') + back + lh('C') + lh('D'),
          },
        ],
      ]),
    );
    expect(song.notes.map((n) => [n.hand, n.velocity])).toEqual([
      ['left', 49],
      ['right', 49],
      ['left', 49],
      ['right', 49],
    ]);
  });

  it('marks on each staff are each hand’s own', () => {
    const song = parse(
      score([
        [
          {
            attributes: grand,
            content: dyn('f', 1) + rh('C') + rh('D') + back + dyn('pp', 2) + lh('C') + lh('D'),
          },
        ],
      ]),
    );
    const of = (hand: string) => song.notes.filter((n) => n.hand === hand).map((n) => n.velocity);
    expect(of('right')).toEqual([96, 96]);
    expect(of('left')).toEqual([33, 33]);
  });

  it('a hairpin on one staff grows from the part’s mark', () => {
    const lhWedge = (type: string) =>
      `<direction placement="below"><direction-type><wedge type="${type}"/></direction-type><staff>2</staff></direction>`;
    const song = parse(
      score([
        [
          {
            attributes: grand,
            content:
              dyn('p', 1) +
              rh('C') +
              rh('D') +
              back +
              lhWedge('crescendo') +
              lh('C') +
              lh('D') +
              lhWedge('stop'),
          },
        ],
      ]),
    );
    const of = (hand: string) => song.notes.filter((n) => n.hand === hand).map((n) => n.velocity);
    expect(of('right')).toEqual([49, 49]);
    // From p one step up to mp over the two beats.
    expect(of('left')).toEqual([49, 57]);
  });

  it('a part without marks is left alone', () => {
    const notes = [
      { startBeat: 0, part: 0, staff: 1 },
      { startBeat: 0, part: 1, staff: 1 },
    ] as { startBeat: number; part: number; staff: number; velocity?: number }[];
    applyDynamics(notes, [{ beat: 0, part: 0, level: 33 }]);
    expect(notes.map((n) => n.velocity)).toEqual([33, undefined]);
  });
});

describe('names that are not marks', () => {
  it('ignores an element called after an object’s own properties', () => {
    expect(velocities(oneBar(dyn('constructor') + q('C', 4)))).toEqual([undefined]);
  });
});

describe('isNotated', () => {
  it('is true for scores and false for recordings and MIDI', () => {
    expect(['musicxml', 'mxl', 'abc', 'mscz'].every((f) => isNotated(f as 'musicxml'))).toBe(true);
    expect(isNotated('midi')).toBe(false);
    expect(isNotated('audio')).toBe(false);
  });
});
