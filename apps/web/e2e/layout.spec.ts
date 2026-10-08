import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// Safari checklist (spec §5, PLAN.md P1-27): iPad Split View and Slide Over at ⅓ width, phones,
// and rotation. Real iPads are still checked by hand before each release.

const SPLIT_VIEW_THIRD = { width: 320, height: 768 };

interface Layout {
  pageWidth: number;
  viewportWidth: number;
  viewportHeight: number;
  canvasTop: number;
  canvasBottom: number;
  canvasHeight: number;
}

function measure(page: Page): Promise<Layout> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const canvas = document.querySelector('canvas')?.getBoundingClientRect();
    return {
      pageWidth: doc.scrollWidth,
      viewportWidth: doc.clientWidth,
      viewportHeight: doc.clientHeight,
      canvasTop: canvas?.top ?? 0,
      canvasBottom: canvas?.bottom ?? 0,
      canvasHeight: canvas?.height ?? 0,
    };
  });
}

/**
 * Centre of the bottom part of the key the practice view highlights for the right hand, read from
 * the canvas pixels so the test does not depend on the piece's keyboard range.
 */
function expectedKeyPoint(page: Page): Promise<{ x: number; y: number } | null> {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return null;
    const rect = canvas.getBoundingClientRect();
    const scale = canvas.width / rect.width;
    const row = Math.round(canvas.height - 3 * scale);
    const data = ctx.getImageData(0, row, canvas.width, 1).data;
    // The right-hand colour, read from the design token so a new palette needs no change here
    // (tokens.css keeps it a plain #rrggbb, which is also what the canvas can use).
    const token = getComputedStyle(document.documentElement).getPropertyValue('--hand-right');
    const rgb = parseInt(token.trim().slice(1), 16);
    const [red, green, blue] = [(rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255];
    const isRight = (i: number) =>
      Math.abs((data[i] ?? 0) - red) < 12 &&
      Math.abs((data[i + 1] ?? 0) - green) < 12 &&
      Math.abs((data[i + 2] ?? 0) - blue) < 12;
    let first = -1;
    let last = -1;
    for (let x = 0; x < canvas.width; x++) {
      if (!isRight(x * 4)) continue;
      if (first < 0) first = x;
      last = x;
    }
    if (first < 0) return null;
    return { x: rect.left + (first + last) / 2 / scale, y: rect.top + row / scale };
  });
}

async function openPractice(page: Page): Promise<void> {
  await page.goto('./#/practice/catalogue/ode-to-joy');
  await expect(page.locator('canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Right', exact: true }).click();
}

/** Taps the highlighted key and checks that wait mode moves on by one step. */
async function tapExpectedKey(page: Page): Promise<void> {
  const stats = page.locator('.stats');
  const before = Number(/Step (\d+)\//.exec((await stats.textContent()) ?? '')?.[1]);
  await expect.poll(() => expectedKeyPoint(page)).not.toBeNull();
  const point = await expectedKeyPoint(page);
  if (!point) throw new Error('No highlighted key');
  await page.mouse.click(point.x, point.y);
  await expect(stats).toContainText(`Step ${before + 1}/`);
}

test('every page fits a ⅓-width iPad window without sideways scrolling', async ({ page }) => {
  await page.setViewportSize(SPLIT_VIEW_THIRD);
  const pages: [string, RegExp][] = [
    ['./', /Free piano practice/],
    ['./#/library', /My library/],
    ['./#/lab', /Detector Lab/],
    ['./#/about', /./],
  ];
  for (const [url, heading] of pages) {
    await page.goto(url);
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    const { pageWidth, viewportWidth } = await measure(page);
    expect(pageWidth, url).toBeLessThanOrEqual(viewportWidth);
  }
});

test('practice is usable at ⅓ iPad width', async ({ page }) => {
  await page.setViewportSize(SPLIT_VIEW_THIRD);
  await openPractice(page);
  // The canvas fills the rest of the window (it follows the bars' height on the next frame): no
  // vertical page scroll, and most of the height.
  await expect
    .poll(async () => {
      const { canvasBottom, viewportHeight } = await measure(page);
      return Math.abs(canvasBottom - viewportHeight);
    })
    .toBeLessThan(2);
  const layout = await measure(page);
  expect(layout.pageWidth).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.canvasHeight).toBeGreaterThan(layout.viewportHeight * 0.5);
  // Every control is still on screen. The secondary ones show only their icon at this width, but
  // keep their names (P4-10), so they are found the same way. Browsers without Web MIDI show a
  // note instead of the MIDI button.
  const hasMidi = await page.evaluate(() => typeof navigator.requestMIDIAccess === 'function');
  for (const name of [
    'Wait',
    'Listen',
    'Play along',
    'Left',
    'Both',
    'Right',
    'Restart',
    'Metronome',
    'Loop',
    'Use microphone',
    'Options',
    ...(hasMidi ? ['Connect MIDI keyboard'] : []),
  ]) {
    const box = await page.getByRole('button', { name, exact: true }).boundingBox();
    expect(box, name).not.toBeNull();
    expect((box?.x ?? 0) + (box?.width ?? 0), name).toBeLessThanOrEqual(layout.viewportWidth);
    expect(box?.x ?? -1, name).toBeGreaterThanOrEqual(0);
  }
  await expect(page.getByRole('slider')).toBeVisible();
  await tapExpectedKey(page);
});

test('practice survives rotation and resizing', async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  await openPractice(page);
  const sizes = [
    { width: 1180, height: 820 }, // iPad landscape
    { width: 820, height: 1180 }, // rotated to portrait
    { width: 375, height: 820 }, // Slide Over / phone portrait
    { width: 820, height: 375 }, // phone landscape
    { width: 1180, height: 820 }, // back to full screen
  ];
  for (const size of sizes) {
    await page.setViewportSize(size);
    const label = `${size.width}×${size.height}`;
    await expect
      .poll(async () => Math.abs((await measure(page)).canvasBottom - size.height), {
        message: `${label}: the canvas reaches the bottom of the window`,
      })
      .toBeLessThan(2);
    const layout = await measure(page);
    expect(layout.pageWidth, label).toBeLessThanOrEqual(size.width);
    expect(layout.canvasHeight, label).toBeGreaterThan(size.height * 0.4);
    await tapExpectedKey(page);
  }
});
