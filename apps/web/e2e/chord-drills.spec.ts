// Chord drills (P7-04 to P7-09): random chords made on the device, on the sheet or as falling keys,
// judged a chord at a time, with the progress kept here. The test draws the same chords from the
// drill's id with the same generator, so it knows which keys to press.
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { drillChords, parseChordDrillId } from '@opentiles/practice';

/** The computer keys from the A key's C4 up (input/touch-input.ts). */
const KEYS = [
  'KeyA',
  'KeyW',
  'KeyS',
  'KeyE',
  'KeyD',
  'KeyF',
  'KeyT',
  'KeyG',
  'KeyY',
  'KeyH',
  'KeyU',
  'KeyJ',
  'KeyK',
  'KeyO',
  'KeyL',
  'KeyP',
  'Semicolon',
];

/** The keys of each chord of a drill, from its id. */
function chordKeys(id: string): string[][] {
  return drillChords(parseChordDrillId(id)).map((c) =>
    [...c.lower, ...c.upper].map((n) => {
      const key = KEYS[n.midi - 60];
      if (!key) throw new Error(`Pitch ${n.midi} is outside the computer keys`);
      return key;
    }),
  );
}

async function playChord(page: Page, keys: readonly string[]): Promise<void> {
  for (const key of keys) await page.keyboard.press(key);
}

/** Pixels in the keyboard's bottom row that have the right hand's colour (a lit key). */
function litKeyPixels(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return -1;
    const rect = canvas.getBoundingClientRect();
    const row = Math.round(canvas.height - 3 * (canvas.width / rect.width));
    const data = ctx.getImageData(0, row, canvas.width, 1).data;
    const token = getComputedStyle(document.documentElement).getPropertyValue('--hand-right');
    const rgb = parseInt(token.trim().slice(1), 16);
    const [r, g, b] = [(rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255];
    let n = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (
        Math.abs((data[i] ?? 0) - r) < 12 &&
        Math.abs((data[i + 1] ?? 0) - g) < 12 &&
        Math.abs((data[i + 2] ?? 0) - b) < 12
      )
        n += 1;
    }
    return n;
  });
}

const score = (page: Page) => page.locator('[data-testid="score-strip"] > svg');

test('the drills hub leads to sight-reading and chords, and old drill links still open', async ({
  page,
}) => {
  await page.goto('./#/drills');
  await expect(page.getByRole('heading', { level: 1, name: 'Drills' })).toBeVisible();
  await page.getByRole('link', { name: /Chords/ }).click();
  await expect(page).toHaveURL(/#\/drills\/chords$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Chords' })).toBeVisible();
  await page.getByRole('link', { name: 'All drills' }).click();
  await page.getByRole('link', { name: /Sight-reading/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Sight-reading' })).toBeVisible();
  await page.goto('./#/practice/drill/treble.0.1.notes.1.123');
  await expect(page.locator('.stats')).toContainText('Step 1/4');
});

test('a chord drill is chosen, read from the sheet with its names, and judged chord by chord', async ({
  page,
}) => {
  await page.goto('./#/drills/chords');
  await page.getByRole('combobox', { name: 'Level' }).selectOption({ index: 0 });
  await page.getByRole('link', { name: 'Start chords' }).click();
  await expect(page).toHaveURL(/#\/practice\/drill\/chords\.l1\.hr\.n16\.t60\.s\d+$/);
  const id = decodeURIComponent(page.url().split('/').pop() ?? '');
  const keys = chordKeys(id);
  await expect(score(page)).toBeVisible({ timeout: 20_000 });
  // Every chord has its name above it, and the first one is marked to play.
  await expect(page.locator('[data-testid="score-strip"] g.dir')).toHaveCount(16);
  await expect(page.locator('g.note.ot-expected')).toHaveCount(3);
  await expect(page.locator('.stats')).toContainText('Chord 1/16');
  expect(await litKeyPixels(page)).toBe(0);
  await playChord(page, keys[0] ?? []);
  await expect(page.locator('.stats')).toContainText('Chord 2/16');
  await expect(page.getByTestId('chord-first-try')).toHaveText('1 of 1 at the first try');
  // A wrong key first: the chord is not right at the first try.
  await page.keyboard.press('KeyW');
  await playChord(page, keys[1] ?? []);
  await expect(page.getByTestId('chord-first-try')).toHaveText('1 of 2 at the first try');
});

test('a round ends with chords a minute, the hardest chord and its cause, and is kept', async ({
  page,
}) => {
  const id = 'chords.l1.hr.n2.t60.s5';
  const keys = chordKeys(id);
  await page.goto(`./#/practice/drill/${id}`);
  await expect(page.locator('.stats')).toContainText('Chord 1/2');
  await playChord(page, keys[0] ?? []);
  // C♯ is a semitone from C, D, F or G: never part of a level 1 chord, often its wrong third.
  await page.keyboard.press('KeyW');
  await playChord(page, keys[1] ?? []);
  const result = page.getByTestId('chord-result');
  await expect(result).toContainText(/\d+ chords a minute/);
  await expect(result).toContainText('1 of 2 at the first try');
  await expect(result.locator('.chord-hardest li')).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'Next round' })).toHaveAttribute(
    'href',
    /#\/practice\/drill\/chords\.l1\.hr\.n16\.t60\.s\d+$/,
  );
  // The next round on this device compares with this one.
  await page.getByRole('button', { name: 'Play again' }).click();
  await expect(page.locator('.stats')).toContainText('Chord 1/2');
  await playChord(page, keys[0] ?? []);
  await playChord(page, keys[1] ?? []);
  await expect(result).toContainText('Your last rounds: 50 % at the first try');
});

test('name only hides the chords to come until they are played or asked for', async ({ page }) => {
  await page.goto('./#/drills/chords');
  await page.getByRole('combobox', { name: 'Chord names' }).selectOption('name-only');
  const id = 'chords.l1.hr.n4.t60.s3';
  const keys = chordKeys(id);
  await page.goto(`./#/practice/drill/${id}`);
  await expect(score(page)).toBeVisible({ timeout: 20_000 });
  const notes = page.locator('[data-testid="score-strip"] g.note');
  const hidden = page.locator('[data-testid="score-strip"] g.note.ot-hidden');
  await expect(notes).toHaveCount(12);
  await expect(hidden).toHaveCount(12);
  await expect(page.locator('[data-testid="score-strip"] g.dir')).toHaveCount(4);
  await playChord(page, keys[0] ?? []);
  await expect(hidden).toHaveCount(9);
  await page.getByRole('button', { name: 'Show me' }).click();
  await expect(hidden).toHaveCount(6);
  await expect(page.getByRole('button', { name: 'Show me' })).toBeDisabled();
  await playChord(page, keys[1] ?? []);
  await expect(page.getByTestId('chord-first-try')).toHaveText('1 of 2 at the first try');
});

test('falling keys draw the chord names on the bars and light the keys, as the level says', async ({
  page,
}) => {
  await page.goto('./#/drills/chords');
  await page.getByRole('combobox', { name: 'Show', exact: true }).selectOption('falling');
  const id = 'chords.l1.hr.n4.t60.s3';
  const keys = chordKeys(id);
  await page.goto(`./#/practice/drill/${id}`);
  const canvas = page.locator('canvas');
  await expect(canvas).toHaveAttribute('data-chords', /\S/);
  await expect(score(page)).toHaveCount(0);
  await expect.poll(() => litKeyPixels(page)).toBeGreaterThan(0);
  const first = (await canvas.getAttribute('data-chords'))?.split(' ')[0];
  await playChord(page, keys[0] ?? []);
  await expect(page.locator('.stats')).toContainText('Chord 2/4');
  // The same drill on the sheet has the same chords: the link is the drill.
  await page.goto('./#/drills/chords');
  await page.getByRole('combobox', { name: 'Show', exact: true }).selectOption('sheet');
  await page.goto(`./#/practice/drill/${id}`);
  await expect(score(page)).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-testid="score-strip"] g.dir').first()).toContainText(
    first ?? '?',
  );
  // Level 7 lights no key in falling keys.
  await page.goto('./#/drills/chords');
  await page.getByRole('combobox', { name: 'Show', exact: true }).selectOption('falling');
  await page.goto('./#/practice/drill/chords.l7.hr.n4.t60.s3');
  await expect(canvas).toHaveAttribute('data-chords', /\S/);
  await page.waitForTimeout(300);
  expect(await litKeyPixels(page)).toBe(0);
});

test('seventh chords at level 6 read from the sheet', async ({ page }) => {
  await page.goto('./#/practice/drill/chords.l6.hr.n8.t60.s21');
  await expect(score(page)).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-testid="score-strip"] g.dir')).toHaveCount(8);
  const chords = drillChords(parseChordDrillId('chords.l6.hr.n8.t60.s21'));
  const notes = chords.reduce((n, c) => n + c.upper.length, 0);
  await expect(page.locator('[data-testid="score-strip"] g.note')).toHaveCount(notes);
  await expect(page.locator('g.note.ot-expected')).toHaveCount(chords[0]?.upper.length ?? 0);
});

test('a chord drill at a tempo counts in and plays along', async ({ page }) => {
  await page.goto('./#/drills/chords');
  await page.getByRole('combobox', { name: 'Pace' }).selectOption('tempo');
  await expect(page.getByRole('spinbutton', { name: 'Beats a minute' })).toHaveValue('60');
  await page.goto('./#/practice/drill/chords.l1.hr.n2.t120.s5');
  await expect(page.getByRole('button', { name: 'Play along' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByRole('timer')).toBeVisible();
  // Two chords at 120 beats a minute: two seconds each after the count-in; nothing played.
  await expect(page.getByTestId('chord-result')).toContainText(
    '0 of 2 chords together and on time',
    {
      timeout: 15_000,
    },
  );
});
