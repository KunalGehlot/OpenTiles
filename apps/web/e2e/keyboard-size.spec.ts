// The keyboard drawn in practice has exactly the keys the learner chose, on any window (P5-16):
// a wide window used to add octaves to a chosen size, so 49, 37 and 25 keys all looked like 61.
// The test reads what the renderer laid out (`data-drawn`) and checks the pixels: the keyboard's
// width and centring, and that a falling note's lane sits over its key.
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/** `MAX_WHITE_WIDTH` in src/views/keyboard.ts. */
const MAX_WHITE = 64;

const PRESETS = [
  { id: '88', low: 21, high: 108 },
  { id: '76', low: 28, high: 103 },
  { id: '73', low: 28, high: 100 },
  { id: '61', low: 36, high: 96 },
  { id: '49', low: 36, high: 84 },
  { id: '37', low: 48, high: 84 },
  { id: '32', low: 41, high: 72 },
  { id: '25', low: 48, high: 72 },
];

/** The keys Ode to Joy needs, which "Fit piece" draws on a narrow window. */
const PIECE_KEYS = '36-72';

const WINDOWS = [
  { width: 2560, height: 1440 },
  { width: 2056, height: 1146 },
  { width: 320, height: 700 },
];

function whites(low: number, high: number): number {
  let n = 0;
  for (let p = low; p <= high; p++) if (![1, 3, 6, 8, 10].includes(p % 12)) n += 1;
  return n;
}

async function chooseSize(page: Page, size: string): Promise<void> {
  await page.getByRole('button', { name: 'Options' }).click();
  await page.getByRole('combobox', { name: 'Keyboard size' }).selectOption(size);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('group', { name: 'Options' })).toHaveCount(0);
}

async function drawnRange(page: Page): Promise<{ low: number; high: number }> {
  const drawn = (await page.locator('canvas').getAttribute('data-drawn')) ?? '';
  const [low, high] = drawn.split('-').map(Number);
  return { low: low ?? NaN, high: high ?? NaN };
}

/** The left and right edges of the drawn keyboard (CSS px), from the canvas's bottom row. */
function keyboardEdges(page: Page): Promise<{ left: number; right: number; width: number }> {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return { left: NaN, right: NaN, width: NaN };
    const rect = canvas.getBoundingClientRect();
    const scale = canvas.width / rect.width;
    const data = ctx.getImageData(0, Math.round(canvas.height - 2 * scale), canvas.width, 1).data;
    const token = getComputedStyle(canvas).getPropertyValue('--canvas-bg').trim();
    const bg = parseInt(token.slice(1), 16);
    const rgb = [(bg >> 16) & 255, (bg >> 8) & 255, bg & 255];
    const isBackground = (x: number) =>
      rgb.every((c, i) => Math.abs((data[x * 4 + i] ?? 0) - c) < 8);
    let first = -1;
    let last = -1;
    for (let x = 0; x < canvas.width; x++) {
      if (isBackground(x)) continue;
      if (first < 0) first = x;
      last = x;
    }
    return { left: first / scale, right: (last + 1) / scale, width: rect.width };
  });
}

/**
 * How far (CSS px) the note falling onto the right hand's key to play now is from that key's
 * centre, or null before both are drawn. The note is found by walking up the canvas from the key's
 * bottom edge through the gap the keyboard's top edge and the now-line leave above it.
 */
function laneOffset(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return null;
    const scale = canvas.width / canvas.getBoundingClientRect().width;
    const token = getComputedStyle(document.documentElement).getPropertyValue('--hand-right');
    const hand = parseInt(token.trim().slice(1), 16);
    const rgb = [(hand >> 16) & 255, (hand >> 8) & 255, hand & 255];
    // The keyboard is at most 40 % of the canvas and the note sits on the now-line above it.
    const from = Math.floor(canvas.height / 2);
    const data = ctx.getImageData(0, from, canvas.width, canvas.height - from).data;
    const on = (x: number, y: number) => {
      const i = ((y - from) * canvas.width + x) * 4;
      return rgb.every((c, j) => Math.abs((data[i + j] ?? 0) - c) < 12);
    };
    // The key: the run of the hand's colour along the bottom row.
    let y = canvas.height - Math.round(2 * scale);
    let k0 = 0;
    while (k0 < canvas.width && !on(k0, y)) k0 += 1;
    let k1 = k0;
    while (k1 < canvas.width && on(k1, y)) k1 += 1;
    if (k0 >= canvas.width) return null;
    // Above it, look within a key's width either side, so a neighbouring lane is not counted.
    const lo = Math.max(0, 2 * k0 - k1);
    const hi = Math.min(canvas.width, 2 * k1 - k0);
    /**
     * Centre (device px) of the hand's colour near the key in row `y`, or null. A few pixels are
     * not enough: a tile's rounded corner can blend to the hand's colour at one point.
     */
    const centre = (row: number): number | null => {
      let first = -1;
      let last = -1;
      for (let x = lo; x < hi; x++) {
        if (!on(x, row)) continue;
        if (first < 0) first = x;
        last = x;
      }
      return first < 0 || (last - first + 1) * 3 < k1 - k0 ? null : (first + last + 1) / 2;
    };
    while (y > from && centre(y) !== null) y -= 1;
    while (y > from && centre(y) === null) y -= 1;
    const lane = centre(y);
    return lane === null ? null : Math.abs(lane - (k0 + k1) / 2) / scale;
  });
}

async function expectLaneOverKey(page: Page, size: string): Promise<void> {
  // Polled: right after a new size the frame on screen may still be the old one.
  await expect
    .poll(() => laneOffset(page), `the lane over its key on ${size} keys`)
    .toBeLessThanOrEqual(1.5);
}

/** The drawn keys fill the width, or are as wide as allowed and centred. */
async function expectFitted(page: Page, low: number, high: number): Promise<void> {
  const n = whites(low, high);
  await expect
    .poll(async () => {
      const e = await keyboardEdges(page);
      const white = Math.min(e.width / n, MAX_WHITE);
      const left = (e.width - white * n) / 2;
      return Math.abs(e.left - left) <= 2 && Math.abs(e.right - (left + white * n)) <= 2;
    })
    .toBe(true);
}

for (const size of WINDOWS) {
  test(`each keyboard size draws its own keys on a ${size.width} px window`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto('./#/practice/catalogue/ode-to-joy');
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();
    await page.getByRole('button', { name: 'Right', exact: true }).click();
    for (const preset of PRESETS) {
      await chooseSize(page, preset.id);
      await expect(canvas).toHaveAttribute('data-keys', `${preset.low}-${preset.high}`);
      await expect(canvas).toHaveAttribute('data-drawn', `${preset.low}-${preset.high}`);
      await expectFitted(page, preset.low, preset.high);
      // On a phone-narrow window an 88-key board has 6 px keys: too thin to find a lane in.
      if (Math.min(size.width / whites(preset.low, preset.high), MAX_WHITE) >= 12) {
        await expectLaneOverKey(page, preset.id);
      }
    }
    // "Fit piece" still fills a wide window with more octaves around the piece's keys.
    await chooseSize(page, 'auto');
    await expect(canvas).toHaveAttribute('data-keys', PIECE_KEYS);
    const [low = NaN, high = NaN] = PIECE_KEYS.split('-').map(Number);
    const drawn = await drawnRange(page);
    if (size.width < 600) expect(drawn).toEqual({ low, high });
    else {
      expect(drawn.low).toBeLessThanOrEqual(low);
      expect(drawn.high).toBeGreaterThanOrEqual(high);
      expect(drawn.high - drawn.low).toBeGreaterThan(high - low);
    }
    await expectFitted(page, drawn.low, drawn.high);
    await expectLaneOverKey(page, 'auto');
  });
}

test('a size chosen in Settings is drawn as chosen when practice opens', async ({ page }) => {
  await page.setViewportSize({ width: 2056, height: 1146 });
  await page.goto('./#/settings');
  await page.getByLabel('Keyboard size').selectOption('25');
  await page.goto('./#/practice/catalogue/ode-to-joy');
  const canvas = page.locator('canvas');
  await expect(canvas).toHaveAttribute('data-drawn', '48-72');
  await expectFitted(page, 48, 72);
  // Narrowing the window (or turning an iPad) keeps the keys; only their width changes.
  for (const size of [
    { width: 320, height: 700 },
    { width: 2056, height: 1146 },
  ]) {
    await page.setViewportSize(size);
    await expect(canvas).toHaveAttribute('data-drawn', '48-72');
    await expectFitted(page, 48, 72);
  }

  // A custom board: 40 keys from A1 end on C5.
  await page.goto('./#/settings');
  await page.getByLabel('Keyboard size').selectOption('custom');
  await page.getByLabel('Lowest key').selectOption({ label: 'A1' });
  await page.getByLabel('Number of keys').fill('40');
  await expect(page.getByTestId('custom-keyboard')).toHaveText('40 keys (A1–C5)');
  await page.goto('./#/practice/catalogue/ode-to-joy');
  await expect(canvas).toHaveAttribute('data-drawn', '33-72');
  await expectFitted(page, 33, 72);
  await page.getByRole('button', { name: 'Right', exact: true }).click();
  await expectLaneOverKey(page, 'custom');
});

test('"Fit piece" and a preset with the same keys still switch on a wide window', async ({
  page,
}) => {
  await page.setViewportSize({ width: 2056, height: 1146 });
  // A self-made tune (CC0) on C4–F4: the keys it needs are C3–C6, the 37-key preset's.
  await page.goto('./#/library');
  await page.getByRole('button', { name: 'Import a file…' }).click();
  await page.getByRole('checkbox').check();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Continue' }).click();
  await (
    await chooser
  ).setFiles({
    name: 'tune.abc',
    mimeType: 'text/plain',
    buffer: Buffer.from('X:1\nT:Four Notes\nL:1/4\nK:C\nCDEF|\n', 'utf8'),
  });
  await page.getByRole('button', { name: 'Save to my library' }).click();
  const canvas = page.locator('canvas');
  await expect(canvas).toHaveAttribute('data-keys', '48-84');
  await expect(canvas).not.toHaveAttribute('data-drawn', '48-84');
  await chooseSize(page, '37');
  await expect(canvas).toHaveAttribute('data-drawn', '48-84');
  await expectFitted(page, 48, 84);
  await chooseSize(page, 'auto');
  await expect(canvas).not.toHaveAttribute('data-drawn', '48-84');
});
