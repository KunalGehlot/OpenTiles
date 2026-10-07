import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  coveringAsset,
  evaluateFindings,
  licenceTextProblem,
  validateExceptions,
} from './policy.mjs';
import { canonicalId, checkExpression, parseSpdx } from './spdx.mjs';

describe('parseSpdx', () => {
  it('gives WITH precedence over AND, and AND over OR', () => {
    assert.deepEqual(parseSpdx('MIT OR Apache-2.0 AND GPL-2.0-only WITH Classpath-exception-2.0'), {
      type: 'or',
      left: { type: 'licence', id: 'MIT' },
      right: {
        type: 'and',
        left: { type: 'licence', id: 'Apache-2.0' },
        right: {
          type: 'with',
          licence: { type: 'licence', id: 'GPL-2.0-only' },
          exception: 'Classpath-exception-2.0',
        },
      },
    });
  });

  it('respects parentheses', () => {
    const tree = parseSpdx('(MIT OR Apache-2.0) AND Unicode-3.0');
    assert.equal(tree.type, 'and');
  });

  it('reads the old Cargo slash syntax as OR', () => {
    assert.deepEqual(parseSpdx('MIT/Apache-2.0'), parseSpdx('MIT OR Apache-2.0'));
  });

  it('accepts lower-case operators', () => {
    assert.deepEqual(parseSpdx('mit or apache-2.0'), parseSpdx('MIT OR Apache-2.0'));
  });

  it('rejects malformed expressions', () => {
    for (const bad of ['', 'MIT OR', '(MIT', 'MIT)', 'AND MIT', 'MIT WITH', 'MIT Apache-2.0']) {
      assert.throws(() => parseSpdx(bad), undefined, bad);
    }
  });
});

describe('canonicalId', () => {
  it('maps deprecated and plus forms', () => {
    assert.equal(canonicalId('GPL-3.0'), 'GPL-3.0-only');
    assert.equal(canonicalId('GPL-3.0+'), 'GPL-3.0-or-later');
    assert.equal(canonicalId('LGPL-2.1+'), 'LGPL-2.1-or-later');
    assert.equal(canonicalId('LGPL-2.1-only+'), 'LGPL-2.1-or-later');
    assert.equal(canonicalId('Apache-2.0+'), 'Apache-2.0');
    assert.equal(canonicalId('bsd-3-clause'), 'BSD-3-Clause');
  });
});

describe('checkExpression', () => {
  it('allows the permissive and copyleft licences on the list', () => {
    for (const ok of [
      'MIT',
      'ISC',
      '0BSD',
      'BlueOak-1.0.0',
      'MPL-2.0',
      'LGPL-3.0-or-later',
      'LGPL-2.1+',
      'GPL-3.0',
      'GPL-2.0-or-later',
      'AGPL-3.0-or-later',
      'Python-2.0',
    ]) {
      assert.equal(checkExpression(ok).allowed, true, ok);
    }
  });

  it('allows an OR when one branch is allowed, and says which', () => {
    const verdict = checkExpression('SSPL-1.0 OR MIT');
    assert.equal(verdict.allowed, true);
    assert.deepEqual(verdict.relied, ['MIT']);
  });

  it('needs every part of an AND', () => {
    assert.equal(checkExpression('Apache-2.0 AND MIT').allowed, true);
    const verdict = checkExpression('MIT AND CC-BY-NC-4.0');
    assert.equal(verdict.allowed, false);
    assert.deepEqual(verdict.problems, ['CC-BY-NC-4.0']);
  });

  it('rejects licences incompatible with the AGPL', () => {
    for (const bad of ['GPL-2.0-only', 'GPL-2.0', 'SSPL-1.0', 'BUSL-1.1', 'CC-BY-SA-4.0']) {
      assert.equal(checkExpression(bad).allowed, false, bad);
    }
  });

  it('treats unknown, missing and custom licences as not allowed', () => {
    assert.equal(checkExpression('Unknown').allowed, false);
    assert.equal(checkExpression('LicenseRef-Proprietary').allowed, false);
    assert.equal(checkExpression(null).error, 'no licence declared');
    assert.match(checkExpression('SEE LICENSE IN LICENSE.md').error ?? '', /not a valid SPDX/);
  });

  it('accepts known permission-only exceptions and rejects unknown ones', () => {
    assert.equal(checkExpression('Apache-2.0 WITH LLVM-exception').allowed, true);
    assert.equal(checkExpression('GPL-2.0-only WITH Classpath-exception-2.0').allowed, false);
    assert.equal(checkExpression('MIT WITH Some-Custom-exception').allowed, false);
  });

  it('allows Creative Commons Attribution for assets only', () => {
    assert.equal(checkExpression('CC-BY-3.0').allowed, false);
    assert.equal(checkExpression('CC-BY-3.0', { asset: true }).allowed, true);
    assert.equal(checkExpression('CC-BY-4.0', { asset: true }).allowed, true);
    assert.equal(checkExpression('CC-BY-NC-4.0', { asset: true }).allowed, false);
  });
});

describe('evaluateFindings', () => {
  const finding = (name, licence, ecosystem = 'npm') => ({
    ecosystem,
    name,
    version: '1.0.0',
    licence,
  });

  it('applies an exception only to the exact licence it was reviewed for', () => {
    const exceptions = validateExceptions({
      exceptions: [
        {
          ecosystem: 'cargo',
          name: 'unicode-ident',
          licence: '(MIT OR Apache-2.0) AND Unicode-3.0',
          reason: 'Unicode-3.0 is permissive',
        },
        { ecosystem: 'npm', name: 'gone', licence: 'Foo', reason: 'stale' },
      ],
    });
    const { results, unusedExceptions } = evaluateFindings(
      [
        finding('unicode-ident', '(MIT OR Apache-2.0) AND Unicode-3.0', 'cargo'),
        finding('unicode-ident', 'Unicode-3.0', 'cargo'),
        finding('left-pad', 'MIT'),
      ],
      exceptions,
    );
    assert.deepEqual(
      results.map((r) => r.status),
      ['excepted', 'rejected', 'allowed'],
    );
    assert.deepEqual(
      unusedExceptions.map((e) => e.name),
      ['gone'],
    );
  });

  it('honours a version pin', () => {
    const exceptions = validateExceptions({
      exceptions: [{ ecosystem: 'npm', name: 'x', version: '2.0.0', licence: 'Odd', reason: 'r' }],
    });
    const { results } = evaluateFindings([finding('x', 'Odd')], exceptions);
    assert.equal(results[0]?.status, 'rejected');
  });

  it('requires a reason on every exception', () => {
    assert.throws(() =>
      validateExceptions({ exceptions: [{ ecosystem: 'npm', name: 'x', licence: 'Odd' }] }),
    );
    assert.throws(() => validateExceptions({}));
  });
});

describe('assets', () => {
  const entries = [
    { path: 'public/samples', licence: 'CC-BY-3.0', source: 's' },
    { path: 'public/samples/special', licence: 'CC0-1.0', source: 's' },
  ];

  it('finds the most specific covering entry', () => {
    assert.equal(coveringAsset('public/samples/a.mp3', entries)?.licence, 'CC-BY-3.0');
    assert.equal(coveringAsset('public/samples/special/b.mp3', entries)?.licence, 'CC0-1.0');
    assert.equal(coveringAsset('public/samplesX/c.mp3', entries), undefined);
    assert.equal(coveringAsset('public/icon.svg', entries), undefined);
  });

  it('checks that a licence file says what is claimed', () => {
    assert.equal(licenceTextProblem('Apache-2.0', 'Apache License\n   Version 2.0, January'), null);
    assert.match(licenceTextProblem('Apache-2.0', 'MIT License') ?? '', /does not look like/);
    assert.match(licenceTextProblem('WTFPL', 'whatever') ?? '', /cannot recognise/);
  });
});
