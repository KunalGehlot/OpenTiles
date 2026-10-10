import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// Metronome and loop section (PLAN.md P1-13, P2-08).

async function openPractice(page: Page): Promise<void> {
  await page.goto('./#/practice/catalogue/ode-to-joy');
  await expect(page.locator('canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Right', exact: true }).click();
}

async function stepCount(page: Page): Promise<number> {
  const text = (await page.locator('.stats').textContent()) ?? '';
  return Number(/Step \d+\/(\d+)/.exec(text)?.[1]);
}

/** Counts metronome clicks: the click is an oscillator at 1320 Hz (1760 Hz accented). */
async function countClicks(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { clickCount: number };
    w.clickCount = 0;
    const start = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function (this: OscillatorNode, when?: number) {
      const f = this.frequency.value;
      if (f === 1320 || f === 1760) w.clickCount += 1;
      return start.call(this, when);
    };
  });
}

const clicks = (page: Page) =>
  page.evaluate(() => (window as unknown as { clickCount: number }).clickCount);

test('the metronome can be switched on and off, with a volume', async ({ page }) => {
  await countClicks(page);
  await openPractice(page);
  const metronome = page.getByRole('button', { name: 'Metronome', exact: true });
  await expect(metronome).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('slider', { name: 'Click volume' })).toHaveCount(0);
  await metronome.click();
  await expect(metronome).toHaveAttribute('aria-pressed', 'true');
  const volume = page.getByRole('slider', { name: 'Click volume' });
  await expect(volume).toBeVisible();
  await volume.fill('80');
  await expect(volume).toHaveValue('80');
  // A steady click in wait mode.
  await expect.poll(() => clicks(page)).toBeGreaterThan(2);
  // It keeps running in play-along.
  await page.getByRole('button', { name: 'Play along' }).click();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
  await expect(metronome).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await metronome.click();
  await expect(metronome).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Wait', exact: true }).click();
  const after = await clicks(page);
  await page.waitForTimeout(1000);
  expect(await clicks(page)).toBe(after);
});

test('dragging across the falling notes loops those bars', async ({ page }) => {
  await openPractice(page);
  await expect(page.locator('.stats')).toContainText('Step 1/');
  const whole = await stepCount(page);
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('No canvas');
  const x = box.x + box.width / 2;
  await page.mouse.move(x, box.y + 12);
  await page.mouse.down();
  await page.mouse.move(x, box.y + box.height * 0.3, { steps: 5 });
  await page.mouse.move(x, box.y + box.height * 0.45, { steps: 5 });
  await page.mouse.up();
  const section = page.getByRole('group', { name: 'Loop a section' });
  await expect(section).toBeVisible();
  await expect(section).toContainText(/Looping bars 1–\d/);
  await expect(page.getByRole('combobox', { name: 'From bar' })).toHaveValue('0');
  const looped = await stepCount(page);
  expect(looped).toBeGreaterThan(0);
  expect(looped).toBeLessThan(whole);
  await expect(page.getByRole('button', { name: 'Loop', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('bars can be chosen to loop without dragging, and wait mode goes round again', async ({
  page,
}) => {
  await openPractice(page);
  const whole = await stepCount(page);
  await page.getByRole('button', { name: 'Loop', exact: true }).click();
  await page.getByRole('combobox', { name: 'To bar' }).selectOption({ label: '1' });
  const section = page.getByRole('group', { name: 'Loop a section' });
  await expect(section).toContainText('Looping bars 1–1');
  const steps = await stepCount(page);
  expect(steps).toBeLessThan(whole);
  // Ode to Joy opens E E F G in the right hand: play bar 1 through with the computer keys.
  for (const key of ['KeyD', 'KeyD', 'KeyF', 'KeyG'].slice(0, steps)) {
    await page.keyboard.press(key);
  }
  await expect(section).toContainText('Run 1: clean');
  await expect(page.locator('.stats')).toContainText(`Step 1/${steps}`);
  await page.getByRole('button', { name: 'Whole piece' }).click();
  await expect.poll(() => stepCount(page)).toBe(whole);
});

test('phrase by phrase loops the first phrase', async ({ page }) => {
  await openPractice(page);
  await page.getByRole('button', { name: 'Loop', exact: true }).click();
  await page.getByRole('button', { name: 'Phrase by phrase' }).click();
  const section = page.getByRole('group', { name: 'Loop a section' });
  await expect(section).toContainText(/Phrase 1 of \d+/);
  await expect(page.getByRole('combobox', { name: 'From bar' })).toHaveValue('0');
  await page.getByRole('button', { name: 'Next phrase' }).first().click();
  await expect(section).toContainText(/Phrase 2 of \d+/);
});

test('the microphone set-up runs once per microphone and can be skipped', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'Fake media devices are configured for Chromium only');
  test.setTimeout(60_000);
  await openPractice(page);
  await page.getByRole('button', { name: 'Use microphone' }).click();
  const dialog = page.getByRole('dialog', { name: 'Microphone set-up' });
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await dialog.getByRole('button', { name: 'Start' }).click();
  await expect(dialog).toContainText('Stay quiet');
  // The fake microphone plays no piano: skip each key.
  for (let i = 0; i < 3; i++) {
    await expect(dialog).toContainText(`Key ${i + 1} of 3`, { timeout: 10_000 });
    await dialog.getByRole('button', { name: 'Skip this key' }).click();
  }
  await dialog.getByRole('button', { name: 'Not now' }).click();
  await expect(dialog).toContainText('Saved for this microphone');
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByText('Microphone listening')).toBeVisible();

  // Next time the stored calibration is used without asking.
  await page.reload();
  await expect(page.locator('canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Use microphone' }).click();
  await expect(page.getByText('Microphone listening')).toBeVisible({ timeout: 10_000 });
  await expect(dialog).toHaveCount(0);
});

test('the overview strip loops bars by dragging, moves the loop with its handles and goes to a bar (P5-07)', async ({
  page,
}) => {
  await openPractice(page);
  const strip = page.getByRole('group', { name: 'Overview of the piece' });
  await expect(strip).toBeVisible();
  const box = await strip.boundingBox();
  if (!box) throw new Error('No overview strip');
  const y = box.y + box.height / 2;
  // Drag across the first quarter of the piece.
  await page.mouse.move(box.x + 2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.15, y, { steps: 5 });
  await page.mouse.move(box.x + box.width * 0.25, y, { steps: 5 });
  await page.mouse.up();
  const section = page.getByRole('group', { name: 'Loop a section' });
  await expect(section).toContainText(/Looping bars 1–\d/);
  await expect(page.getByRole('combobox', { name: 'From bar' })).toHaveValue('0');
  const end = page.getByRole('slider', { name: 'Loop ends at bar' });
  const before = Number(await end.getAttribute('aria-valuenow'));
  expect(before).toBeGreaterThan(1);
  // The end handle moves with the arrow keys.
  await end.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(end).toHaveAttribute('aria-valuenow', String(before - 1));
  await expect(page.getByRole('combobox', { name: 'To bar' })).toHaveValue(String(before - 2));
  await page.getByRole('button', { name: 'Whole piece' }).click();
  await expect(end).toHaveCount(0);

  // A tap goes to that bar: wait mode moves on to a later step.
  await expect(page.locator('.stats')).toContainText('Step 1/');
  await page.mouse.click(box.x + box.width * 0.6, y);
  await expect(page.locator('.stats')).not.toContainText('Step 1/');
});

test('live stats are off until chosen, then count the run (P5-07)', async ({ page }) => {
  await openPractice(page);
  await expect(page.getByTestId('live-stats')).toHaveCount(0);
  await page.getByRole('button', { name: 'Options' }).click();
  await page.getByRole('checkbox', { name: 'Live stats' }).check();
  await page.keyboard.press('Escape');
  const live = page.getByTestId('live-stats');
  await expect(live).toBeVisible();
  await page.keyboard.press('KeyD'); // E4, right
  await page.keyboard.press('KeyA'); // C4, wrong
  await page.keyboard.press('KeyD'); // E4, right after a wrong key
  await expect(live).toContainText('1 perfect');
  await expect(live).toContainText('1 good');
  await expect(live).toContainText('1 wrong');
  await expect(live).toContainText('streak 1');
  // Remembered on this device.
  await page.reload();
  await expect(page.getByTestId('live-stats')).toBeVisible();
});

test('the screen stays on while the practice screen is open (P5-02)', async ({ page }) => {
  // A stand-in Screen Wake Lock that records requests and releases, in every engine.
  await page.addInitScript(() => {
    const log = { requests: 0, releases: 0 };
    (window as unknown as { wakeLog: typeof log }).wakeLog = log;
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: {
        request: () => {
          log.requests += 1;
          const listeners: (() => void)[] = [];
          const sentinel = {
            released: false,
            release: () => {
              if (!sentinel.released) {
                sentinel.released = true;
                log.releases += 1;
                for (const l of listeners) l();
              }
              return Promise.resolve();
            },
            addEventListener: (_type: string, l: () => void) => listeners.push(l),
          };
          return Promise.resolve(sentinel);
        },
      },
    });
  });
  const wakeLog = () =>
    page.evaluate(
      () => (window as unknown as { wakeLog: { requests: number; releases: number } }).wakeLog,
    );
  await page.goto('./');
  expect(await wakeLog()).toEqual({ requests: 0, releases: 0 });
  await page.goto('./#/practice/catalogue/ode-to-joy');
  await expect(page.locator('canvas')).toBeVisible();
  await expect.poll(async () => (await wakeLog()).requests).toBe(1);
  await page.locator('.session-bar a.back').click();
  await expect(page).toHaveURL(/#\/$/);
  await expect.poll(async () => (await wakeLog()).releases).toBe(1);
});
