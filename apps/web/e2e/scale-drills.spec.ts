// Scale drills (P7-19 to P7-21): random scales made on the device, with their key signatures and
// fingers, on the sheet, from memory or as falling keys, judged a scale at a time. The test draws
// the same scales from the drill's id with the same generator, so it knows which keys to press.
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { drillScales, parseScaleDrillId } from '@opentiles/practice';

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

/** C and D major, one octave, right hand: C4 to D5 fits the computer keys. */
const ID = 'scales.lc.k1.r5.hr.o1.d4.n2.t80.s3';

/** The keys of each scale of a drill, in order, from its id. */
function scaleKeys(id: string): string[][] {
  return drillScales(parseScaleDrillId(id)).map((s) =>
    s.upper.map((n) => {
      const key = KEYS[n.midi - 60];
      if (!key) throw new Error(`Pitch ${n.midi} is outside the computer keys`);
      return key;
    }),
  );
}

async function play(page: Page, keys: readonly string[]): Promise<void> {
  for (const key of keys) await page.keyboard.press(key);
}

const score = (page: Page) => page.locator('[data-testid="score-strip"] > svg');

/** A choice on the setup page, by its label (its hint follows the label in its name). */
const select = (page: Page, label: string) =>
  page.getByRole('combobox', { name: new RegExp(`^${label}`) });

async function choose(page: Page, label: string, value: string): Promise<void> {
  await page.goto('./#/drills/scales');
  await select(page, label).selectOption(value);
}

test('the drills hub leads to scales, whose levels start with their own hands', async ({
  page,
}) => {
  await page.goto('./#/drills');
  await page.getByRole('link', { name: /Scales/ }).click();
  await expect(page).toHaveURL(/#\/drills\/scales$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Scales' })).toBeVisible();
  const start = page.getByRole('link', { name: 'Start scales' });
  await expect(start).toHaveAttribute(
    'href',
    /#\/practice\/drill\/scales\.l1\.hr\.o1\.d4\.n4\.t80\.s\d+$/,
  );
  await page.getByRole('combobox', { name: 'Level' }).selectOption('6');
  await expect(page.getByRole('combobox', { name: 'Hands' })).toHaveValue('together');
  await expect(page.getByRole('combobox', { name: 'Octaves' })).toHaveValue('2');
  await expect(select(page, 'Show')).toHaveValue('memory');
  await expect(start).toHaveAttribute('href', /scales\.l6\.ht\.o2\.d4\.n4\.t80\.s\d+$/);
});

test('a scale drill is read from the sheet with its names and fingers, and judged scale by scale', async ({
  page,
}) => {
  await choose(page, 'Show', 'sheet');
  const keys = scaleKeys(ID);
  await page.goto(`./#/practice/drill/${ID}`);
  await expect(score(page)).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-testid="score-strip"] g.dir')).toHaveCount(2);
  await expect(page.locator('[data-testid="score-strip"] g.fing')).toHaveCount(30);
  await expect(page.locator('.stats')).toContainText('Step 1/30');
  await play(page, keys[0] ?? []);
  await expect(page.getByTestId('chord-first-try')).toHaveText('1 of 1 at the first try');
  // C♯ for D major's D: the key's sharp in the wrong place.
  await page.keyboard.press('KeyW');
  await play(page, keys[1] ?? []);
  const result = page.getByTestId('scale-result');
  await expect(result).toContainText(/\d+ notes a minute/);
  await expect(result).toContainText('1 of 2 scales at the first try');
  await expect(result.locator('.chord-hardest li')).toHaveCount(1);
  await expect(result.locator('.chord-hardest li')).toContainText("the key's sharp or flat");
  await expect(page.getByTestId('scale-evenness')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Next round' })).toHaveAttribute(
    'href',
    /#\/practice\/drill\/scales\.l1\.hr\.o1\.d4\.n4\.t80\.s\d+$/,
  );
});

test('from memory, the notes and fingers to come stay hidden until played or asked for', async ({
  page,
}) => {
  await choose(page, 'Show', 'memory');
  const keys = scaleKeys(ID);
  await page.goto(`./#/practice/drill/${ID}`);
  await expect(score(page)).toBeVisible({ timeout: 20_000 });
  const hidden = page.locator('[data-testid="score-strip"] g.note.ot-hidden');
  await expect(hidden).toHaveCount(30);
  // The names and key signatures stay; the fingers of a hidden bar do not.
  await expect(page.locator('[data-testid="score-strip"] g.dir')).toHaveCount(2);
  const finger = page.locator('[data-testid="score-strip"] g.fing').first();
  await expect.poll(() => finger.evaluate((el) => getComputedStyle(el).visibility)).toBe('hidden');
  await play(page, (keys[0] ?? []).slice(0, 4));
  await expect(hidden).toHaveCount(26);
  await expect.poll(() => finger.evaluate((el) => getComputedStyle(el).visibility)).toBe('visible');
  await page.getByRole('button', { name: 'Show me' }).click();
  await expect(hidden).toHaveCount(15);
  await expect(page.getByRole('button', { name: 'Show me' })).toBeDisabled();
  await play(page, (keys[0] ?? []).slice(4));
  await expect(page.getByRole('button', { name: 'Show me' })).toBeEnabled();
});

test('falling keys draw the scale names over the bars', async ({ page }) => {
  await choose(page, 'Show', 'falling');
  const keys = scaleKeys(ID);
  await page.goto(`./#/practice/drill/${ID}`);
  const canvas = page.locator('canvas');
  await expect(canvas).toHaveAttribute('data-chords', /C major/);
  await expect(score(page)).toHaveCount(0);
  await play(page, (keys[0] ?? []).slice(0, 2));
  await expect(page.locator('.stats')).toContainText('Step 3/30');
});

test('hands together and contrary motion are written on two staves with every finger', async ({
  page,
}) => {
  // The left hand is below the computer keys: this checks the drawing, not the playing.
  await page.goto('./#/practice/drill/scales.lc.k1.r1.ht.o1.d4.n1.t80.s1');
  await expect(score(page)).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-testid="score-strip"] g.staff').first()).toBeVisible();
  await expect(page.locator('[data-testid="score-strip"] g.fing')).toHaveCount(30);
  await expect(page.locator('[data-testid="score-strip"] g.note')).toHaveCount(30);
  await expect(page.locator('.stats')).toContainText('Step 1/15');
  await expect(page.locator('g.note.ot-expected')).toHaveCount(2);
  // Contrary motion starts both hands on middle C: one key, two notes on the page.
  await page.goto('./#/practice/drill/scales.lc.k1.r1.hc.o1.d4.n1.t80.s1');
  await expect(score(page)).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-testid="score-strip"] g.note')).toHaveCount(30);
  await expect(page.locator('.stats')).toContainText('Step 1/15');
  await page.keyboard.press('KeyA');
  await expect(page.locator('.stats')).toContainText('Step 2/15');
});

test('a scale drill at a tempo counts in and plays along, in quavers if chosen', async ({
  page,
}) => {
  await choose(page, 'Pace', 'tempo');
  await page.getByRole('combobox', { name: 'Note values' }).selectOption('quavers');
  await page.getByRole('combobox', { name: 'Beats a minute' }).selectOption('100');
  await expect(page.getByRole('link', { name: 'Start scales' })).toHaveAttribute(
    'href',
    /scales\.l1\.hr\.o1\.d8\.n4\.t100\.s\d+$/,
  );
  await page.goto('./#/practice/drill/scales.lc.k1.r1.hr.o1.d8.n1.t160.s1');
  await expect(page.getByRole('button', { name: 'Play along' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByRole('timer')).toBeVisible();
  // Fifteen quavers at 160 crotchets a minute, about three seconds after the count-in.
  await expect(page.getByTestId('scale-result')).toContainText('0 of 1 scales clean and on time', {
    timeout: 15_000,
  });
});
