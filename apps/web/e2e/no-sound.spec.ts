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
  await page.keyboard.press('KeyD'); // E4
  await expect(stats).toContainText('Step 2/');
  await page.keyboard.press('KeyD'); // E4 again
  await expect(stats).toContainText('Step 3/');
});

test('a listen run plays through without sound', async ({ page }) => {
  await page.goto('./#/practice/catalogue/ode-to-joy');
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Score' }).click();
  await expect(page.locator('[data-testid="score-strip"] > svg')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Listen', exact: true }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(() => scoreOffset(page), { timeout: 15_000 }).toBeGreaterThan(40);
});
