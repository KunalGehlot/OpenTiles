import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// The scrolling score keeps its clefs and key signature in view (issue #75, PLAN.md P1-15): once
// the opening has scrolled away, a header pinned at the left edge shows them as Verovio drew them.
// "In the Hall of the Mountain King" is in B minor: two sharps on both staves.

async function openScore(page: Page): Promise<void> {
  await page.goto('./#/practice/catalogue/hall-of-the-mountain-king');
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Score' }).click();
  await expect(page.locator('[data-testid="score-strip"] > svg')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('score-cursor')).toBeVisible();
}

/** Drags the score to the left by most of the view's width, holding still before letting go. */
async function dragLeft(page: Page): Promise<void> {
  const box = await page.locator('.ot-score-host').boundingBox();
  if (!box) throw new Error('no score box');
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * 0.9, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.1, y, { steps: 10 });
  await page.waitForTimeout(150);
  await page.mouse.up();
}

/** What the header shows: per staff, whether its clef is painted and how many accidentals. */
function shownHeads(page: Page) {
  return page.evaluate(() => {
    const key = document.querySelector('[data-testid="score-key"]');
    const region = [...(key?.querySelectorAll<SVGGElement>('g.ot-key-region') ?? [])].find(
      (g) => g.style.display !== 'none',
    );
    return [...(region?.querySelectorAll('g.ot-key-staff') ?? [])].map((staff) => {
      const clef = staff.querySelector('g.clef')?.getBoundingClientRect();
      return {
        clef: !!clef && clef.width > 2 && clef.height > 10,
        accidentals: staff.querySelectorAll('g.keyAccid').length,
        sharps: [...staff.querySelectorAll('g.keyAccid use')].every((u) =>
          /^#E262-/.test(u.getAttribute('href') ?? ''),
        ),
      };
    });
  });
}

/** Heights of the header's top staff line and the score's, in CSS pixels. */
function topLines(page: Page) {
  return page.evaluate(() => {
    const y = (sel: string) => {
      const r = document.querySelector(sel)?.getBoundingClientRect();
      return r ? r.top + r.height / 2 : NaN;
    };
    return {
      header: y('[data-testid="score-key"] g.ot-key-lines path'),
      score: y('[data-testid="score-strip"] g.measure g.staff > path'),
    };
  });
}

test('the scrolling score pins its clefs and key signature once the opening has gone', async ({
  page,
}) => {
  await openScore(page);
  const key = page.getByTestId('score-key');
  // At the start the real opening is in view, so there is no second key signature.
  await page.waitForTimeout(300);
  await expect(key).toBeHidden();
  await expect(key).toHaveAttribute('aria-hidden', 'true');

  await dragLeft(page);
  await expect(key).toBeVisible();
  await expect
    .poll(() => shownHeads(page))
    .toEqual([
      { clef: true, accidentals: 2, sharps: true },
      { clef: true, accidentals: 2, sharps: true },
    ]);
  // Painted at the score's own scale and height: the staff lines run on without a step.
  const lines = await topLines(page);
  expect(Math.abs(lines.header - lines.score)).toBeLessThan(0.75);
  // It sits at the left edge and takes no pointer, so the score can still be dragged through it.
  const box = await key.boundingBox();
  const host = await page.locator('.ot-score-host').boundingBox();
  expect(Math.abs((box?.x ?? -1) - (host?.x ?? 0))).toBeLessThan(1);
  expect(await key.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none');
});

test('the pinned key signature fits a third of an iPad and goes when the score is back at its start', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await openScore(page);
  const key = page.getByTestId('score-key');
  await dragLeft(page);
  await dragLeft(page);
  await expect(key).toBeVisible();
  await expect.poll(async () => (await shownHeads(page)).map((s) => s.accidentals)).toEqual([2, 2]);
  const box = await key.boundingBox();
  // Narrow enough to leave the play bar in the middle of the view clear.
  expect(box?.width ?? 999).toBeLessThan(320 / 2 - 20);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  // Dragged back to the start, the real opening shows again and the header goes.
  const host = await page.locator('.ot-score-host').boundingBox();
  if (!host) throw new Error('no score box');
  const y = host.y + host.height / 2;
  for (let i = 0; i < 3; i++) {
    await page.mouse.move(host.x + host.width * 0.1, y);
    await page.mouse.down();
    await page.mouse.move(host.x + host.width * 0.9, y, { steps: 8 });
    await page.waitForTimeout(150);
    await page.mouse.up();
  }
  await expect(key).toBeHidden();
});

test('the page view has no pinned header', async ({ page }) => {
  await page.goto('./#/practice/catalogue/hall-of-the-mountain-king');
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Sheet' }).click();
  await expect(page.locator('[data-testid="score-strip"] > svg')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('score-key')).toHaveCount(0);
});
