import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// Score views (PLAN.md P1-15, P2-11, P1-24): Verovio draws the score, the cursor follows the
// practice session and the hardest bars are marked after a run.

/** Cursor position relative to the start of the drawn score, in CSS pixels. */
function cursorX(page: Page): Promise<number> {
  return page.evaluate(() => {
    const cursor = document.querySelector('[data-testid="score-cursor"]');
    const strip = document.querySelector('[data-testid="score-strip"]');
    if (!cursor || !strip || (cursor as HTMLElement).hidden) return -1;
    return cursor.getBoundingClientRect().left - strip.getBoundingClientRect().left;
  });
}

test('the scrolling score draws a catalogue piece and its cursor follows the notes', async ({
  page,
}) => {
  await page.goto('./#/practice/catalogue/ode-to-joy');
  await page.getByRole('button', { name: 'Right', exact: true }).click();
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Score' }).click();
  const svg = page.locator('[data-testid="score-strip"] > svg');
  await expect(svg).toBeVisible({ timeout: 20_000 });
  expect(await page.locator('[data-testid="score-strip"] g.note').count()).toBeGreaterThan(10);
  await expect(page.locator('[data-testid="score-cursor"]')).toBeVisible();
  await expect(page.locator('g.note.ot-expected')).not.toHaveCount(0);
  const start = await cursorX(page);
  expect(start).toBeGreaterThan(0);

  const stats = page.locator('.stats');
  await page.keyboard.press('KeyD'); // E4
  await expect(stats).toContainText('Step 2/');
  await page.keyboard.press('KeyD'); // E4
  await expect(stats).toContainText('Step 3/');
  await expect(page.locator('g.note.ot-correct')).toHaveCount(2);
  await expect.poll(() => cursorX(page)).toBeGreaterThan(start + 10);

  // A wrong key turns the expected note red.
  await page.keyboard.press('KeyA'); // C4, F4 expected
  await expect(page.locator('g.note.ot-wrong')).not.toHaveCount(0);
});

test('the page view fits a third of an iPad and turns pages with the keyboard', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 768 });
  await page.goto('./#/practice/catalogue/minuet-in-g');
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Page' }).click();
  await expect(page.locator('[data-testid="score-strip"] > svg')).toBeVisible({ timeout: 20_000 });
  const pager = page.locator('.ot-score-pager');
  await expect(pager).toContainText(/Page 1 of \d+/);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  const total = Number((await pager.textContent())?.match(/of (\d+)/)?.[1] ?? 1);
  if (total > 1) {
    await page.keyboard.press('PageDown');
    await expect(pager).toContainText('Page 2 of');
    await page.keyboard.press('PageUp');
    await expect(pager).toContainText('Page 1 of');
  }
  // Fingering from the score (P2-12).
  expect(await page.locator('[data-testid="score-strip"] g.fing').count()).toBeGreaterThan(0);
});

test('the score engraver is precached for offline use and loaded only on demand', async ({
  page,
  request,
}) => {
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  await page.goto('./#/practice/catalogue/ode-to-joy');
  await expect(page.locator('canvas')).toBeVisible();
  expect(requests.some((u) => u.includes('verovio'))).toBe(false);
  const sw = await (await request.get('./sw.js')).text();
  expect(sw).toMatch(/"assets\/verovio-module-[\w-]+\.js"/);
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Score' }).click();
  await expect(page.locator('[data-testid="score-strip"] > svg')).toBeVisible({ timeout: 20_000 });
  // Nothing is fetched from another origin (hard rule 5).
  const origin = new URL(page.url()).origin;
  expect(requests.filter((u) => !u.startsWith(origin) && !u.startsWith('data:'))).toEqual([]);
});

/** A self-made one-bar MusicXML file (CC0): C4 D4 E4 for the right hand. */
const TINY_SCORE = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0"><work><work-title>Three notes</work-title></work>
<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
<part id="P1"><measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key>
<time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
<note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>
<note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>
<note><pitch><step>E</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>half</type></note>
</measure></part></score-partwise>`;

test('the hardest bars are marked on the score after a run', async ({ page }) => {
  await page.goto('./#/library');
  await page.getByRole('button', { name: 'Import a file…' }).click();
  await page.getByRole('checkbox').check();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Continue' }).click();
  await (
    await chooser
  ).setFiles({
    name: 'three-notes.musicxml',
    mimeType: 'application/vnd.recordare.musicxml+xml',
    buffer: Buffer.from(TINY_SCORE),
  });
  await page.getByRole('button', { name: 'Save to my library' }).click();
  await expect(page).toHaveURL(/#\/practice\/library\//);
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Score' }).click();
  await expect(page.locator('[data-testid="score-strip"] > svg')).toBeVisible({ timeout: 20_000 });
  await page.keyboard.press('KeyA'); // C4
  await page.keyboard.press('KeyF'); // F4: wrong
  await page.keyboard.press('KeyS'); // D4
  await page.keyboard.press('KeyD'); // E4
  await expect(page.getByText(/Hardest bars: 1/)).toBeVisible();
  await expect(page.locator('[data-testid="score-strip"] .ot-hardest')).toHaveCount(1);
});

test('MIDI imports offer the falling-notes view only, and say why', async ({ page }) => {
  await page.goto('./#/library');
  await page.getByRole('button', { name: 'Import a file…' }).click();
  await page.getByRole('checkbox').check();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Continue' }).click();
  // C4 D4 as quarter notes in a one-track MIDI file.
  const events = [
    0, 0x90, 60, 80, 0x83, 0x60, 0x80, 60, 0, 0, 0x90, 62, 80, 0x83, 0x60, 0x80, 62, 0,
  ];
  events.push(0, 0xff, 0x2f, 0);
  const midi = Buffer.from([
    ...[0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xe0],
    ...[0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, events.length],
    ...events,
  ]);
  await (await chooser).setFiles({ name: 'two.mid', mimeType: 'audio/midi', buffer: midi });
  await page.getByRole('button', { name: 'Save to my library' }).click();
  await expect(page).toHaveURL(/#\/practice\/library\//);
  const view = page.getByRole('group', { name: 'View' });
  await expect(view.getByRole('button', { name: 'Score' })).toBeDisabled();
  await expect(page.getByText('MIDI files have no printed score')).toBeVisible();
});

test('the scrolling score keeps the play bar in the middle, shows no scroll bar and can be dragged', async ({
  page,
}) => {
  await page.goto('./#/practice/catalogue/ode-to-joy');
  await page.getByRole('button', { name: 'Right', exact: true }).click();
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Score' }).click();
  await expect(page.locator('[data-testid="score-strip"] > svg')).toBeVisible({ timeout: 20_000 });
  const host = page.locator('.ot-score-host');
  // Nothing to scroll with a bar: the score is moved by transform.
  expect(await host.evaluate((el) => getComputedStyle(el).overflowX)).toBe('hidden');
  expect(
    await host.evaluate((el) => (el as HTMLElement).offsetHeight - el.clientHeight),
  ).toBeLessThanOrEqual(0);

  const barOffset = () =>
    page.evaluate(() => {
      const h = document.querySelector('.ot-score-host')?.getBoundingClientRect();
      const c = document.querySelector('[data-testid="score-cursor"]')?.getBoundingClientRect();
      return h && c ? c.left - (h.left + h.width / 2) : NaN;
    });
  for (let i = 0; i < 4; i++) await page.keyboard.press('KeyD'); // E4 E4 F4 G4 need other keys; any press
  await expect.poll(async () => Math.abs(await barOffset())).toBeLessThan(3);

  // A drag scrubs: the score moves under the play bar, which stays in the middle (P4-18).
  const box = await host.boundingBox();
  if (!box) throw new Error('no score box');
  const before = await page.evaluate(
    () => document.querySelector('.ot-score-mover')?.getAttribute('style') ?? '',
  );
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height / 2, { steps: 6 });
  expect(Math.abs(await barOffset())).toBeLessThan(3);
  await page.mouse.up();
  const after = await page.evaluate(
    () => document.querySelector('.ot-score-mover')?.getAttribute('style') ?? '',
  );
  expect(after).not.toEqual(before);
  await expect.poll(async () => Math.abs(await barOffset())).toBeLessThan(3);
});

test('dragging the score scrubs through the piece, back and forth, and Play starts there', async ({
  page,
}) => {
  await page.goto('./#/practice/catalogue/silent-night');
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Score' }).click();
  await expect(page.locator('[data-testid="score-strip"] > svg')).toBeVisible({ timeout: 20_000 });
  const host = page.locator('.ot-score-host');
  const box = await host.boundingBox();
  if (!box) throw new Error('no score box');
  const barOffset = () =>
    page.evaluate(() => {
      const h = document.querySelector('.ot-score-host')?.getBoundingClientRect();
      const c = document.querySelector('[data-testid="score-cursor"]')?.getBoundingClientRect();
      return h && c ? c.left - (h.left + h.width / 2) : NaN;
    });
  const step = async () =>
    Number(/Step (\d+)\//.exec((await page.locator('.stats').textContent()) ?? '')?.[1]);
  const y = box.y + box.height / 2;
  const drag = async (from: number, to: number) => {
    await page.mouse.move(box.x + box.width * from, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * to, y, { steps: 10 });
    // Hold still before letting go, so it does not coast.
    await page.waitForTimeout(150);
    await page.mouse.up();
  };

  expect(await step()).toBe(1);
  // Forward: drag the score to the left.
  await drag(0.8, 0.2);
  await expect.poll(step).toBeGreaterThan(3);
  const forward = await step();
  expect(Math.abs(await barOffset())).toBeLessThan(3);
  // Back: drag it to the right again, a little less far.
  await drag(0.3, 0.6);
  await expect.poll(step).toBeLessThan(forward);
  expect(await step()).toBeGreaterThan(1);
  expect(Math.abs(await barOffset())).toBeLessThan(3);

  // Listen starts from the scrubbed place, not from the beginning.
  const offset = () =>
    page.evaluate(() => {
      const mover = document.querySelector('.ot-score-mover') as HTMLElement | null;
      const m = /translate3d\((-?[\d.]+)px/.exec(mover?.style.transform ?? '');
      return m ? -Number(m[1]) : 0;
    });
  const scrubbed = await offset();
  expect(scrubbed).toBeGreaterThan(40);
  await page.getByRole('button', { name: 'Listen', exact: true }).click();
  // Changing mode rebuilds the run; scrub again, then play.
  await drag(0.8, 0.5);
  const from = await offset();
  expect(from).toBeGreaterThan(40);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForTimeout(2500);
  expect(await offset()).toBeGreaterThanOrEqual(from - 2);
  expect(Math.abs(await barOffset())).toBeLessThan(3);
});

/** Horizontal offset of the scrolling score, in CSS pixels (0 = at the start). */
function scoreOffset(page: Page): Promise<number> {
  return page.evaluate(() => {
    const mover = document.querySelector('.ot-score-mover') as HTMLElement | null;
    const m = /translate3d\((-?[\d.]+)px/.exec(mover?.style.transform ?? '');
    return m ? -Number(m[1]) : 0;
  });
}

test('the scrolling score returns to its start after a listen run', async ({ page }) => {
  await page.goto('./#/practice/catalogue/joy-to-the-world');
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Score' }).click();
  await expect(page.locator('[data-testid="score-strip"] > svg')).toBeVisible({ timeout: 20_000 });
  const startX = await cursorX(page);
  await page.getByRole('button', { name: 'Listen', exact: true }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  // The score moves past the play bar while the piece plays ...
  await expect.poll(() => scoreOffset(page), { timeout: 15_000 }).toBeGreaterThan(40);
  // ... and is back at the start a moment after the last note.
  await expect.poll(() => scoreOffset(page), { timeout: 20_000 }).toBeLessThan(1);
  // The play bar is back on the first note too, not left on the last one.
  await expect.poll(() => cursorX(page), { timeout: 10_000 }).toBeCloseTo(startX, -1);
});

test('the scrolling score returns to its start after a wait-mode run', async ({ page }) => {
  await page.goto('./#/practice/catalogue/joy-to-the-world-melody');
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Score' }).click();
  await expect(page.locator('[data-testid="score-strip"] > svg')).toBeVisible({ timeout: 20_000 });
  const startX = await cursorX(page);
  // C5 B4 A4 G4 F4 E4 D4 C4 G4 A4 A4 B4 B4 C5 on the computer keys.
  const keys = ['K', 'J', 'H', 'G', 'F', 'D', 'S', 'A', 'G', 'H', 'H', 'J', 'J', 'K'];
  for (const [i, key] of keys.entries()) {
    await page.keyboard.press(`Key${key}`);
    if (i === 8) expect(await scoreOffset(page)).toBeGreaterThan(20);
    await page.waitForTimeout(250);
  }
  await expect(page.locator('.stats')).toContainText('✓ 14', { timeout: 10_000 });
  await expect.poll(() => scoreOffset(page), { timeout: 20_000 }).toBeLessThan(1);
  await expect.poll(() => cursorX(page), { timeout: 10_000 }).toBeCloseTo(startX, -1);
});

test('the page view goes back to the first page after a run', async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 600 });
  await page.goto('./#/practice/catalogue/minuet-in-g-melody');
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Page' }).click();
  await expect(page.locator('[data-testid="score-strip"] > svg')).toBeVisible({ timeout: 20_000 });
  const pager = page.locator('.ot-score-pager');
  await expect(pager).toContainText(/Page 1 of \d+/);
  await page.getByRole('button', { name: 'Listen', exact: true }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForTimeout(3000);
  await expect
    .poll(async () => (await pager.textContent()) ?? '', { timeout: 60_000 })
    .toMatch(/Page 1 of/);
});

test('the piece can be shifted by semitones during practice (P5-04)', async ({ page }) => {
  await page.goto('./#/practice/catalogue/ode-to-joy');
  await page.getByRole('button', { name: 'Right', exact: true }).click();
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Score' }).click();
  await expect(page.locator('[data-testid="score-strip"] > svg')).toBeVisible({ timeout: 20_000 });
  // C major: no sharps or flats in the key signature.
  const keyAccidentals = page.locator('[data-testid="score-strip"] g.keyAccid');
  await expect(keyAccidentals).toHaveCount(0);

  await page.getByRole('button', { name: 'Options' }).click();
  const up = page.getByRole('button', { name: 'Up a semitone' });
  await up.click();
  await up.click();
  await expect(page.getByTestId('transpose')).toHaveText('+2');
  await expect(page.getByRole('status').filter({ hasText: 'Transposed' })).toHaveText(
    'Transposed up 2 semitones.',
  );
  // The score is engraved again in D major.
  await expect(keyAccidentals).not.toHaveCount(0, { timeout: 20_000 });
  await page.keyboard.press('Escape');

  // The tune starts on E4, now F♯4: E4 is wrong, F♯4 moves on.
  const stats = page.locator('.stats');
  await page.keyboard.press('KeyD'); // E4
  await expect(page.locator('g.note.ot-wrong')).not.toHaveCount(0);
  await expect(stats).toContainText('Step 1/');
  await page.keyboard.press('KeyT'); // F♯4
  await expect(stats).toContainText('Step 2/');

  await page.getByRole('button', { name: 'Options' }).click();
  const down = page.getByRole('button', { name: 'Down a semitone' });
  await down.click();
  await down.click();
  await expect(page.getByTestId('transpose')).toHaveText('0');
  await expect(page.getByRole('status').filter({ hasText: 'Transposed' })).toHaveCount(0);
  await expect(keyAccidentals).toHaveCount(0, { timeout: 20_000 });
});
