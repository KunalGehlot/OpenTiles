// Light or dark chosen in Settings (P5-09) whatever the device's own mode, high contrast with it,
// the practice canvas following, and the choice there again after a reload.
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const background = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);

/** How bright the falling-notes canvas is along its top row (0–255), once it has drawn. */
const canvasBrightness = (page: Page) =>
  page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('.practice-canvas-wrap canvas');
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || canvas.width === 0) return null;
    const data = ctx.getImageData(0, 2, canvas.width, 1).data;
    let sum = 0;
    let drawn = 0;
    for (let i = 0; i < data.length; i += 4) {
      if ((data[i + 3] ?? 0) === 0) continue;
      sum += ((data[i] ?? 0) + (data[i + 1] ?? 0) + (data[i + 2] ?? 0)) / 3;
      drawn += 1;
    }
    return drawn > 0 ? sum / drawn : null;
  });

async function choose(page: Page, appearance: 'Same as this device' | 'Light' | 'Dark') {
  await page.goto('./#/settings');
  await page.getByRole('combobox', { name: 'Appearance' }).selectOption({ label: appearance });
}

test.describe('on a device in light mode', () => {
  test.use({ colorScheme: 'light' });

  test('dark chosen in Settings is dark everywhere, the canvas too, and after a reload', async ({
    page,
  }) => {
    await page.goto('./#/');
    expect(await background(page)).toBe('rgb(243, 245, 244)');
    await choose(page, 'Dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await background(page)).toBe('rgb(11, 16, 15)');
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe(
      'dark',
    );

    await page.goto('./#/practice/catalogue/twinkle-twinkle');
    await expect(page.locator('.stats')).toBeVisible();
    await expect.poll(() => canvasBrightness(page)).toBeLessThan(60);

    // After a reload the choice is there before the page has a body, so nothing is drawn light.
    await page.addInitScript(() => {
      const w = window as unknown as { __themeAtBody?: string | null };
      new MutationObserver((_, observer) => {
        if (!document.body) return;
        w.__themeAtBody = document.documentElement.getAttribute('data-theme');
        observer.disconnect();
      }).observe(document, { childList: true, subtree: true });
    });
    await page.reload();
    expect(
      await page.evaluate(() => (window as unknown as { __themeAtBody?: string }).__themeAtBody),
    ).toBe('dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await background(page)).toBe('rgb(11, 16, 15)');

    // High contrast keeps its own dark colours.
    await page.goto('./#/settings');
    await page.getByRole('combobox', { name: 'High contrast' }).selectOption({ label: 'On' });
    expect(await background(page)).toBe('rgb(0, 0, 0)');

    // Back to the device's mode.
    await page.getByRole('combobox', { name: 'High contrast' }).selectOption({ label: 'Off' });
    await choose(page, 'Same as this device');
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /./);
    expect(await background(page)).toBe('rgb(243, 245, 244)');
  });
});

test.describe('on a device in dark mode', () => {
  test.use({ colorScheme: 'dark' });

  test('light chosen in Settings is light, the canvas too', async ({ page }) => {
    await page.goto('./#/');
    expect(await background(page)).toBe('rgb(11, 16, 15)');
    await choose(page, 'Light');
    expect(await background(page)).toBe('rgb(243, 245, 244)');
    await page.goto('./#/practice/catalogue/twinkle-twinkle');
    await expect(page.locator('.stats')).toBeVisible();
    await expect.poll(() => canvasBrightness(page)).toBeGreaterThan(180);
  });
});
