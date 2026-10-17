// Sight-reading drills (P5-05): generated on the device, read from the score, nothing given away.
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

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

/** Wait mode moves on only for the right key: try C4–G4 and its black keys until it moves. */
async function playStep(page: Page): Promise<void> {
  const stats = page.locator('.stats');
  const before = Number(/Step (\d+)\//.exec((await stats.textContent()) ?? '')?.[1]);
  for (const key of ['KeyA', 'KeyW', 'KeyS', 'KeyE', 'KeyD', 'KeyF', 'KeyT', 'KeyG']) {
    await page.keyboard.press(key);
    const now = Number(/Step (\d+)\//.exec((await stats.textContent()) ?? '')?.[1]);
    if (now !== before || (await page.locator('.summary').count()) > 0) return;
  }
  throw new Error('No key in C4–G4 moved the drill on');
}

test('a drill is chosen, read from the score with nothing given away, and timed', async ({
  page,
}) => {
  await page.goto('./#/drills');
  await expect(page.getByRole('heading', { level: 1, name: 'Sight-reading' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Key' }).selectOption({ label: 'G major' });
  await page.getByRole('link', { name: 'Start a drill' }).click();
  await expect(page).toHaveURL(/#\/practice\/drill\/treble\.1\.1\.notes\.8\.\d+$/);
  await expect(page.locator('[data-testid="score-strip"] > svg')).toBeVisible({ timeout: 20_000 });
  // The score shows the note to read; no view switch, no overview, no lit key.
  await expect(page.locator('g.note.ot-expected')).not.toHaveCount(0);
  await expect(page.getByRole('group', { name: 'View' })).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Overview of the piece' })).toHaveCount(0);
  await expect(page.locator('.stats')).toContainText('Step 1/32');
  expect(await litKeyPixels(page)).toBe(0);
  await playStep(page);
  await expect(page.locator('.stats')).toContainText('Step 2/32');
});

test('a short drill ends with the reading speed and starts the next one', async ({ page }) => {
  // One bar: four notes, around middle C in C major, so the keys A–G cover every note.
  await page.goto('./#/practice/drill/treble.0.1.notes.1.123');
  await expect(page.locator('.stats')).toContainText('Step 1/4');
  for (let i = 0; i < 4; i++) await playStep(page);
  await expect(page.getByTestId('drill-speed')).toContainText(/\d+ notes a minute/);
  await page.getByRole('link', { name: 'Next drill' }).click();
  await expect(page).toHaveURL(/#\/practice\/drill\/treble\.0\.1\.notes\.8\.\d+$/);
  await expect(page).not.toHaveURL(/\.123$/);
  await expect(page.locator('.stats')).toContainText('Step 1/32');
});

test('an endless drill starts the next one by itself after showing the result', async ({
  page,
}) => {
  await page.goto('./#/drills');
  await page.getByRole('checkbox', { name: 'Endless' }).check();
  // The choice is kept; a one-bar drill (four notes around middle C in C major) is opened directly.
  await page.goto('./#/drills');
  await expect(page.getByRole('checkbox', { name: 'Endless' })).toBeChecked();
  await page.goto('./#/practice/drill/treble.0.1.notes.1.123');
  await expect(page.locator('.stats')).toContainText('Step 1/4');
  for (let i = 0; i < 4; i++) await playStep(page);
  await expect(page.getByTestId('drill-speed')).toContainText(/\d+ notes a minute/);
  await expect(page.getByText('The next drill starts in a moment.')).toBeVisible();
  // No click: a new drill with the chosen settings follows.
  await expect(page).not.toHaveURL(/\.123$/, { timeout: 10_000 });
  await expect(page).toHaveURL(/#\/practice\/drill\/treble\.\d+\.\d+\.notes\.\d+\.\d+$/);
  await expect(page.locator('.summary')).toHaveCount(0);
  await expect(page.locator('.stats')).toContainText('Step 1/');
});

test('showing the key to press lights it up', async ({ page }) => {
  await page.goto('./#/drills');
  await page.getByRole('checkbox', { name: /Show the key to press/ }).check();
  await page.getByRole('link', { name: 'Start a drill' }).click();
  await expect(page.locator('[data-testid="score-strip"] > svg')).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => litKeyPixels(page)).toBeGreaterThan(0);
});

test('a grand-staff drill draws both staves and links their notes', async ({ page }) => {
  await page.goto('./#/practice/drill/both.-1.2.phrases.2.77');
  await expect(page.locator('[data-testid="score-strip"] > svg')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.stats')).toContainText('Step 1/8');
  // Two staves in every bar, eight notes, and the first one marked as the one to read.
  await expect(
    page.locator('[data-testid="score-strip"] g.measure').first().locator('g.staff'),
  ).toHaveCount(2);
  await expect(page.locator('[data-testid="score-strip"] g.note')).toHaveCount(8);
  await expect(page.locator('g.note.ot-expected')).toHaveCount(1);
});
