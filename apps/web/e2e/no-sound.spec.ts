// Practice keeps working when the browser cannot start sound: no sound device, or audio still
// blocked. Firefox then leaves AudioContext.resume() pending and the audio clock at 0, which froze
// the metronome button, listen runs and the falling notes (seen on Linux CI runners). A stand-in
// context that never starts reproduces that in every engine.
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const Native = window.AudioContext;
    class NeverStarts extends Native {
      override get state(): AudioContextState {
        return 'suspended';
      }
      override get currentTime(): number {
        return 0;
      }
      override resume(): Promise<void> {
        return new Promise(() => {});
      }
    }
    window.AudioContext = NeverStarts;
  });
});

function scoreOffset(page: Page): Promise<number> {
  return page.evaluate(() => {
    const mover = document.querySelector('.ot-score-mover') as HTMLElement | null;
    const m = /translate3d\((-?[\d.]+)px/.exec(mover?.style.transform ?? '');
    return m ? -Number(m[1]) : 0;
  });
}

test('the metronome and wait mode work without sound', async ({ page }) => {
  await page.goto('./#/practice/catalogue/ode-to-joy');
  await page.getByRole('button', { name: 'Right', exact: true }).click();
  const metronome = page.getByRole('button', { name: 'Metronome', exact: true });
  await metronome.click();
  // At once, not after unlockAudio() gives up waiting for sound, and remembered right away.
  await expect(metronome).toHaveAttribute('aria-pressed', 'true', { timeout: 1000 });
  await page.waitForTimeout(300);
  await page.reload();
  await expect(metronome).toHaveAttribute('aria-pressed', 'true');
  const stats = page.locator('.stats');
  // The first key waits once for sound to start; after that try, keys play at once.
  await page.keyboard.press('KeyD'); // E4
  await expect(stats).toContainText('Step 2/');
  await page.keyboard.press('KeyD'); // E4 again
  await expect(stats).toContainText('Step 3/', { timeout: 500 });
  await page.keyboard.press('KeyF'); // F4
  await expect(stats).toContainText('Step 4/', { timeout: 500 });
});

test('a listen run plays through without sound', async ({ page }) => {
  await page.goto('./#/practice/catalogue/ode-to-joy');
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Score' }).click();
  await expect(page.locator('[data-testid="score-strip"] > svg')).toBeVisible({ timeout: 20_000 });
  // The first note starts under the play bar, so the score is already moved a little.
  await expect.poll(() => scoreOffset(page)).toBeGreaterThan(0);
  const start = await scoreOffset(page);
  await page.getByRole('button', { name: 'Listen', exact: true }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(() => scoreOffset(page), { timeout: 15_000 }).toBeGreaterThan(start + 40);
});

test('Stop acts at once, without waiting for sound to start', async ({ page }) => {
  await page.goto('./#/practice/catalogue/ode-to-joy');
  await page.getByRole('button', { name: 'Listen', exact: true }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  // unlockAudio() gives up after 2 s; Stop must not wait for it.
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible({
    timeout: 1000,
  });
});
