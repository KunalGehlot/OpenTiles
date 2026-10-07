import { describe, expect, it } from 'vitest';
import { difficultyPath, nextPiece } from '../src/catalogue/path';
import { credentialToJson, requestOptionsFromJson } from '../src/sync/webauthn';

const pieces = [
  { slug: 'b', title: 'B tune', difficulty: 1 },
  { slug: 'a', title: 'A tune', difficulty: 1 },
  { slug: 'c', title: 'C tune', difficulty: 2 },
  { slug: 'd', title: 'D tune', difficulty: 4 },
];

describe('difficulty path', () => {
  it('groups by level from first steps upwards, skipping empty levels', () => {
    const path = difficultyPath(pieces, new Map());
    expect(path.map((l) => l.level)).toEqual([1, 2, 4]);
    expect(path[0]?.pieces.map((p) => p.slug)).toEqual(['a', 'b']);
    expect(path.map((l) => l.status)).toEqual(['current', 'upcoming', 'upcoming']);
    expect(nextPiece(path, new Map())?.slug).toBe('a');
  });

  it('counts progress per level from best scores', () => {
    const best = new Map([
      ['catalogue:a', 0.95],
      ['catalogue:b', 0.6],
      ['catalogue:c', 0.3],
      ['library:1', 1],
    ]);
    const path = difficultyPath(pieces, best);
    expect(path[0]).toMatchObject({ played: 2, mastered: 1, status: 'current' });
    expect(path[0]?.progress).toBeCloseTo((0.95 + 0.6) / 2);
    // The started piece is suggested before an unplayed one.
    expect(nextPiece(path, best)?.slug).toBe('b');
  });

  it('marks fully mastered levels done and moves on', () => {
    const best = new Map([
      ['catalogue:a', 0.9],
      ['catalogue:b', 1],
    ]);
    const path = difficultyPath(pieces, best);
    expect(path.map((l) => l.status)).toEqual(['done', 'current', 'upcoming']);
    expect(nextPiece(path, best)?.slug).toBe('c');
    const all = new Map(pieces.map((p) => [`catalogue:${p.slug}`, 1]));
    expect(difficultyPath(pieces, all).every((l) => l.status === 'done')).toBe(true);
    expect(nextPiece(difficultyPath(pieces, all), all)).toBeNull();
  });

  it('clamps odd difficulty values into levels 1 to 5', () => {
    const path = difficultyPath(
      [
        { slug: 'x', title: 'X', difficulty: 0 },
        { slug: 'y', title: 'Y', difficulty: 9 },
      ],
      new Map(),
    );
    expect(path.map((l) => l.level)).toEqual([1, 5]);
  });
});

describe('passkey JSON conversion', () => {
  it('turns base64url options into buffers and credentials back into JSON', () => {
    const opts = requestOptionsFromJson({
      challenge: 'AQID',
      rpId: 'opentiles.example',
      allowCredentials: [{ id: 'BAUG', type: 'public-key' }],
    });
    expect(new Uint8Array(opts.challenge as ArrayBuffer)).toEqual(new Uint8Array([1, 2, 3]));
    expect(opts.rpId).toBe('opentiles.example');
    const json = credentialToJson({
      id: 'cred',
      rawId: new Uint8Array([4, 5, 6]).buffer,
      type: 'public-key',
      response: {
        clientDataJSON: new Uint8Array([1]).buffer,
        authenticatorData: new Uint8Array([2]).buffer,
        signature: new Uint8Array([3]).buffer,
        userHandle: null,
      },
    });
    expect(json).toMatchObject({
      id: 'cred',
      rawId: 'BAUG',
      type: 'public-key',
      response: { clientDataJSON: 'AQ', authenticatorData: 'Ag', signature: 'Aw' },
    });
    expect('userHandle' in (json.response as object)).toBe(false);
  });
});
