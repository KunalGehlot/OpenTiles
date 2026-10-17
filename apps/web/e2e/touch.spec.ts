// Touch screens (P5-09): every control on the main pages, a library card and the practice
// Options panel is at least 44 px either way where the pointer is a finger, and nothing pushes a
// phone-width page sideways. Inline links inside running text are left out, as WCAG 2.5.8 does.
// The piece imported is a MIDI file generated in sheet-import-fixtures.ts (CC0).
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { tinyMidi } from './sheet-import-fixtures';

test.use({ hasTouch: true, isMobile: true });

/** Visible controls smaller than 44 px, with their size. */
function smallControls(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const selector =
      'button, a[href], select, input:not([type=hidden]), summary, [role=button], [role=slider], [role=tab], [role=radio], [role=checkbox]';
    for (const el of document.querySelectorAll<HTMLElement>(selector)) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || getComputedStyle(el).visibility === 'hidden') continue;
      // A switch or checkbox is tapped anywhere on its label.
      const label = el.closest('label');
      if (el.tagName === 'INPUT' && label && label.getBoundingClientRect().height >= 43.5) continue;
      // A link inside running text.
      const parent = el.parentElement;
      if (
        el.tagName === 'A' &&
        parent &&
        !el.classList.contains('button') &&
        !el.closest('nav') &&
        (parent.textContent ?? '').trim().length > (el.textContent ?? '').trim().length + 3
      ) {
        continue;
      }
      if (r.width < 43.5 || r.height < 43.5) {
        const name = (el.getAttribute('aria-label') ?? el.textContent ?? el.tagName)
          .trim()
          .replace(/\s+/g, ' ')
          .slice(0, 40);
        out.push(
          `${el.tagName.toLowerCase()} "${name}" ${Math.round(r.width)}×${Math.round(r.height)}`,
        );
      }
    }
    return out;
  });
}

const sideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

for (const width of [1180, 375]) {
  test(`every control is a finger’s size at ${width} px`, async ({ page, browserName }) => {
    test.skip(browserName === 'firefox', 'Firefox has no mobile emulation in Playwright');
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 820 });
    await page.goto('./#/library');
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);

    // A piece in the library, so its card is measured too.
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import a file…' }).click();
    await page.getByRole('checkbox', { name: /I only import files/ }).check();
    await page.getByRole('button', { name: 'Continue' }).click();
    await (
      await chooser
    ).setFiles([{ name: 'Little Study.mid', mimeType: 'audio/midi', buffer: tinyMidi() }]);
    await expect(page.getByRole('heading', { name: 'Check the import' })).toBeVisible();
    expect(await smallControls(page), 'import review').toEqual([]);
    await page.getByRole('button', { name: 'Save to my library' }).click();
    await expect(page).toHaveURL(/#\/practice\/library\//);

    for (const hash of ['#/', '#/library', '#/drills', '#/settings', '#/about', '#/sheet-music']) {
      await page.goto(`./${hash}`);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await page.waitForTimeout(300);
      expect(await smallControls(page), hash).toEqual([]);
      if (width < 400) expect(await sideways(page), hash).toBeLessThanOrEqual(0);
    }

    await page.goto('./#/practice/catalogue/twinkle-twinkle');
    await expect(page.locator('.stats')).toBeVisible();
    expect(await smallControls(page), 'practice').toEqual([]);
    if (width < 400) expect(await sideways(page), 'practice').toBeLessThanOrEqual(0);
    await page.getByRole('button', { name: 'Options' }).click();
    await page.waitForTimeout(300);
    expect(await smallControls(page), 'practice options').toEqual([]);
  });
}
