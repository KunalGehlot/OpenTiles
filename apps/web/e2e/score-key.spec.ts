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

/**
 * A self-made score (CC0), written here: quarter notes in D major, then from bar 7 in E♭ major
 * with the lower staff changing to a treble clef; or a single staff in D major throughout.
 */
function changingScore(staves: 1 | 2): string {
  const note = (step: string, octave: number, staff: number) =>
    `<note><pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>1</duration><type>quarter</type><staff>${staff}</staff></note>`;
  const bars = Array.from({ length: 14 }, (_, i) => {
    const later = staves === 2 && i >= 6;
    const attrs =
      i === 0
        ? `<attributes><divisions>1</divisions><key><fifths>2</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time>${
            staves === 2
              ? '<staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef>'
              : '<clef><sign>G</sign><line>2</line></clef>'
          }</attributes>`
        : later && i === 6
          ? '<attributes><key><fifths>-3</fifths></key><clef number="2"><sign>G</sign><line>2</line></clef></attributes>'
          : '';
    const upper = ['D', 'E', 'G', 'A'].map((s) => note(s, 5, 1)).join('');
    const lower =
      staves === 2
        ? '<backup><duration>4</duration></backup>' +
          ['D', 'F', 'A', 'F'].map((s) => note(s, later ? 4 : 3, 2)).join('')
        : '';
    return `<measure number="${i + 1}">${attrs}${upper}${lower}</measure>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="3.1"><work><work-title>Changing Keys</work-title></work><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">${bars.join('')}</part></score-partwise>`;
}

async function importScore(page: Page, text: string): Promise<void> {
  await page.goto('./#/library');
  await page.getByRole('button', { name: 'Import a file…' }).click();
  await page.getByRole('checkbox').check();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Continue' }).click();
  await (
    await chooser
  ).setFiles({ name: 'changing.musicxml', mimeType: 'application/xml', buffer: Buffer.from(text) });
  await page.getByRole('button', { name: 'Save to my library' }).click();
  await expect(page).toHaveURL(/#\/practice\/library\//);
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Score' }).click();
  await expect(page.locator('[data-testid="score-strip"] > svg')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('score-cursor')).toBeVisible();
}

/**
 * Drags the score left until `x` (page px) reaches the view's left edge, in drags of at most 70 %
 * of the view, each held still before letting go so it does not coast. (Mobile WebKit has no
 * wheel events in Playwright.)
 */
async function scrollTo(page: Page, x: number): Promise<void> {
  const host = await page.locator('.ot-score-host').boundingBox();
  if (!host) throw new Error('no score box');
  const y = host.y + host.height / 2;
  let left = x - host.x;
  while (left > 1) {
    const dx = Math.min(left, host.width * 0.7);
    const from = host.x + host.width * 0.85;
    await page.mouse.move(from, y);
    await page.mouse.down();
    await page.mouse.move(from - dx, y, { steps: 8 });
    await page.waitForTimeout(150);
    await page.mouse.up();
    left -= dx;
  }
}

/** The displayed region's clefs (glyph codes) and key accidentals (glyph codes), per staff. */
function shownGlyphs(page: Page) {
  return page.evaluate(() => {
    const key = document.querySelector<HTMLElement>('[data-testid="score-key"]');
    const shown = [...(key?.querySelectorAll<SVGGElement>('g.ot-key-region') ?? [])].filter(
      (g) => g.style.display !== 'none',
    );
    const code = (u: Element | null) => /E[0-9A-F]{3}/.exec(u?.getAttribute('href') ?? '')?.[0];
    return {
      visible: !!key && !key.hidden,
      regions: shown.length,
      staves: [...(shown[0]?.querySelectorAll('g.ot-key-staff') ?? [])].map((staff) => ({
        clef: code(staff.querySelector('g.clef use')),
        key: [...staff.querySelectorAll('g.keyAccid use')].map(code),
      })),
    };
  });
}

test('the pinned header follows a key and clef change and stays one header after a resize', async ({
  page,
}) => {
  await importScore(page, changingScore(2));
  // Just past the opening: D major, treble and bass clefs.
  const staffStart = await page
    .locator('[data-testid="score-strip"] g.measure g.staff > path')
    .first()
    .boundingBox();
  await scrollTo(page, (staffStart?.x ?? 0) + 40);
  await expect
    .poll(() => shownGlyphs(page))
    .toEqual({
      visible: true,
      regions: 1,
      staves: [
        { clef: 'E050', key: ['E262', 'E262'] },
        { clef: 'E062', key: ['E262', 'E262'] },
      ],
    });

  // Past bar 7: E♭ major on both staves, and the lower staff's treble clef at full size.
  const change = await page
    .locator('[data-testid="score-strip"] g.keySig')
    .filter({ has: page.locator('use[*|href^="#E260"]') })
    .first()
    .boundingBox();
  await scrollTo(page, (change?.x ?? 0) + 10);
  const flats = ['E260', 'E260', 'E260'];
  await expect
    .poll(() => shownGlyphs(page))
    .toEqual({
      visible: true,
      regions: 1,
      staves: [
        { clef: 'E050', key: flats },
        { clef: 'E050', key: flats },
      ],
    });

  // A narrower window moves the score under the edge; still one header, never two overlaid.
  await page.setViewportSize({ width: 700, height: 800 });
  await page.waitForTimeout(400);
  expect((await shownGlyphs(page)).regions).toBeLessThanOrEqual(1);
});

test('a single staff gets its pinned clef and key signature too', async ({ page }) => {
  await importScore(page, changingScore(1));
  await expect(page.getByTestId('score-key')).toBeHidden();
  const staffStart = await page
    .locator('[data-testid="score-strip"] g.measure g.staff > path')
    .first()
    .boundingBox();
  await scrollTo(page, (staffStart?.x ?? 0) + 40);
  await expect
    .poll(() => shownGlyphs(page))
    .toEqual({ visible: true, regions: 1, staves: [{ clef: 'E050', key: ['E262', 'E262'] }] });
});
