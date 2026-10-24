// Settings, encrypted backup, legal pages and the Home difficulty path (P2-13, P2-15, P2-17,
// P3-05, P4-05). The MIDI fixture is generated here (CC0).
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/** A one-track MIDI file: C4 D4 E4 F4 as quarter notes. */
function tinyMidi(): Buffer {
  const events: number[] = [];
  [60, 62, 64, 65].forEach((p) => {
    events.push(0, 0x90, p, 80, 0x83, 0x60, 0x80, p, 0);
  });
  events.push(0, 0xff, 0x2f, 0);
  const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xe0];
  const len = events.length;
  return Buffer.from([...header, 0x4d, 0x54, 0x72, 0x6b, 0, 0, len >> 8, len & 0xff, ...events]);
}

async function importMidi(page: Page, title: string) {
  await page.goto('./#/library');
  await page.getByRole('button', { name: 'Import a file…' }).click();
  await page.getByRole('checkbox').check();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Continue' }).click();
  await (await chooser).setFiles({ name: 'scale.mid', mimeType: 'audio/midi', buffer: tinyMidi() });
  await page.getByLabel('Title').fill(title);
  await page.getByRole('button', { name: 'Save to my library' }).click();
  await expect(page).toHaveURL(/#\/practice\/library\//);
}

test('accessibility settings persist and apply app-wide', async ({ page }) => {
  await page.goto('./');
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Settings' })
    .click();
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();

  await page.getByLabel(/Large print/).check();
  await page.getByLabel('High contrast').selectOption('on');
  await page.getByLabel(/Left-handed layout/).check();
  await page.getByLabel('Turn pages with a foot pedal').check();
  await page.getByLabel('Next page').selectOption('PageDown');
  await expect(page.locator('html')).toHaveAttribute('data-large-print', '');
  await expect(page.locator('html')).toHaveAttribute('data-high-contrast', '');

  await page.reload();
  await expect(page.getByLabel(/Large print/)).toBeChecked();
  await expect(page.getByLabel('High contrast')).toHaveValue('on');
  await expect(page.getByLabel(/Left-handed layout/)).toBeChecked();
  await expect(page.getByLabel('Next page')).toHaveValue('PageDown');
  await expect(page.locator('html')).toHaveAttribute('data-left-handed', '');

  // Applies on other pages too, and large print really makes text bigger.
  await page.goto('./#/');
  await expect(page.locator('html')).toHaveAttribute('data-large-print', '');
  const size = await page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
  expect(parseFloat(size)).toBeGreaterThan(16);

  await expect(page.getByRole('table')).toHaveCount(0);
  await page.goto('./#/settings');
  await expect(page.getByRole('cell', { name: 'Start the piece again' })).toBeVisible();
  // Crash reports go to the sync server; this build has none, so they are not mentioned at all.
  await expect(page.getByRole('heading', { name: 'Crash reports' })).toHaveCount(0);
});

test('follows prefers-reduced-motion until the user chooses', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./#/settings');
  await expect(page.locator('html')).toHaveAttribute('data-reduced-motion', '');
  await page.getByLabel('Reduce motion').selectOption('off');
  await expect(page.locator('html')).not.toHaveAttribute('data-reduced-motion', '');
});

test('an encrypted backup can be exported and restored without duplicates', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  await importMidi(page, 'Backup Study');

  await page.goto('./#/settings');
  await page.getByRole('button', { name: 'Export backup…' }).click();
  await page.getByLabel('Passphrase', { exact: true }).fill('short');
  await expect(page.getByText('Too short.')).toBeVisible();
  await page.getByLabel('Passphrase', { exact: true }).fill('violet tram cellar mango');
  await page.getByLabel('Passphrase again').fill('violet tram cellar mangx');
  await expect(page.getByText('The two passphrases are different.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download backup' })).toBeDisabled();
  await page.getByLabel('Passphrase again').fill('violet tram cellar mango');
  const downloading = page.waitForEvent('download', { timeout: 60_000 });
  await page.getByRole('button', { name: 'Download backup' }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/^opentiles-backup-\d{4}-\d{2}-\d{2}\.zip$/);
  const file = testInfo.outputPath('backup.zip');
  await download.saveAs(file);
  const bytes = readFileSync(file);
  expect(bytes.subarray(0, 2).toString('latin1')).toBe('PK');
  expect(bytes.includes(Buffer.from('Backup Study'))).toBe(false);

  // Restoring onto the same device adds nothing.
  const restore = async (pass: string) => {
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Restore from a backup…' }).click();
    await (await chooser).setFiles(file);
    await page.getByLabel('Backup passphrase').fill(pass);
    await page.getByRole('button', { name: 'Restore', exact: true }).click();
  };
  await restore('wrong passphrase here');
  await expect(page.getByText(/does not open this/)).toBeVisible({ timeout: 30_000 });
  await page.getByLabel('Backup passphrase').fill('violet tram cellar mango');
  await page.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Restored' })).toContainText(
    '0 pieces added, 1 already here',
    { timeout: 30_000 },
  );

  // Delete it, then restore it from the file.
  await page.goto('./#/library');
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('Nothing here yet.')).toBeVisible();
  await page.goto('./#/settings');
  await restore('violet tram cellar mango');
  await expect(page.getByRole('status').filter({ hasText: 'Restored' })).toContainText(
    '1 piece added',
    { timeout: 30_000 },
  );
  await page.goto('./#/library');
  await expect(page.locator('.card h3', { hasText: 'Backup Study' })).toHaveCount(1);
});

test('the privacy policy and Impressum exist in English and German', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('contentinfo').getByRole('link', { name: 'Privacy' }).click();
  await expect(page.getByRole('heading', { name: 'Privacy policy', level: 1 })).toBeVisible();
  await expect(page.getByText(/no cookies/).first()).toBeVisible();
  // It names the host, and says nothing of sync or crash reports in a build without a sync server.
  await expect(page.getByText(/hosted on GitHub Pages/)).toBeVisible();
  await expect(page.locator('main')).not.toContainText(/sync|crash report/i);
  await page.getByRole('link', { name: 'Deutsch' }).click();
  await expect(page).toHaveURL(/#\/privacy\/de$/);
  await expect(page.getByRole('heading', { name: 'Datenschutzerklärung', level: 1 })).toBeVisible();
  await expect(page.locator('main')).not.toContainText(/Synchronisier|Absturz/);

  await page.getByRole('contentinfo').getByRole('link', { name: 'Impressum' }).click();
  await expect(page.getByRole('heading', { name: /Impressum/, level: 1 })).toBeVisible();
  await expect(page.getByText('Kunal Gehlot').first()).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Kunal.gehlot@rwth-aachen.de' }).first(),
  ).toBeVisible();
  // The operator's website is a contact; it has no Impressum of its own, so none is linked.
  await expect(page.getByRole('link', { name: 'gehlot.site' }).first()).toHaveAttribute(
    'href',
    'https://gehlot.site/',
  );
  await expect(page.locator('main')).not.toContainText(/gehlot\.site\/impressum|Postal address/);
  await expect(page.getByRole('heading', { name: /Notice and takedown/ })).toBeVisible();
  await page.getByRole('link', { name: 'Deutsch' }).click();
  await expect(
    page.getByRole('heading', { name: 'Impressum', exact: true, level: 1 }),
  ).toBeVisible();
  await expect(page.getByText('Angaben gemäß § 5 DDG.')).toBeVisible();

  await page.goto('./#/about');
  await expect(page.locator('main').getByRole('link', { name: 'Impressum' })).toBeVisible();
  await expect(page.locator('main').getByRole('link', { name: 'privacy policy' })).toBeVisible();
});

test('the Home page shows a difficulty path with progress and teacher links', async ({
  page,
  context,
  browserName,
}) => {
  // Only Chromium knows the clipboard permissions; elsewhere the copy may fall back to showing the
  // link in a field.
  const clipboard = browserName === 'chromium';
  if (clipboard) await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('./');
  const path = page.getByRole('list', { name: 'Difficulty path' });
  await expect(path.getByRole('heading', { name: 'Level 1 · First steps' })).toBeVisible();
  const levels = await path.locator('.path-level h3').allTextContents();
  const numbers = levels.map((t) => Number(/Level (\d)/.exec(t)?.[1]));
  expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
  await expect(path.locator('.path-level').first()).toHaveClass(/path-level--current/);
  await expect(path.locator('.path-level').first()).toContainText(/0 of \d+ mastered · 0 played/);

  // A best score shows up in the level's progress.
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('opentiles');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const tx = open.result.transaction('progress', 'readwrite');
        tx.objectStore('progress').put({
          key: 'catalogue:hot-cross-buns',
          bestAccuracy: 0.95,
          runs: 1,
          lastPlayedAt: Date.now(),
          secondsPractised: 30,
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
    });
  });
  await page.reload();
  await expect(path.locator('.path-level').first()).toContainText(/1 of \d+ mastered · 1 played/);

  await page.getByRole('button', { name: 'Copy link to Ode to Joy (theme)' }).click();
  if (clipboard) {
    await expect(page.getByRole('button', { name: 'Copy link to Ode to Joy (theme)' })).toHaveText(
      'Link copied',
    );
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toMatch(/#\/practice\/catalogue\/ode-to-joy$/);
  } else {
    const done = page.getByRole('button', { name: 'Copy link to Ode to Joy (theme)' });
    const fallback = page.getByRole('textbox', { name: 'Link to Ode to Joy (theme)' });
    await expect(done.filter({ hasText: 'Link copied' }).or(fallback)).toBeVisible();
    if (await fallback.isVisible()) {
      await expect(fallback).toHaveValue(/#\/practice\/catalogue\/ode-to-joy$/);
    }
  }

  // Library items never get a link.
  await page.goto('./#/library');
  await expect(page.getByRole('button', { name: /Copy link/ })).toHaveCount(0);
});

test('the new pages fit a ⅓-width iPad window, also with large print', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 768 });
  await page.goto('./#/settings');
  await page.getByLabel(/Large print/).check();
  for (const url of ['./#/settings', './#/privacy', './#/impressum/de', './', './#/drills']) {
    await page.goto(url);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const widths = await page.evaluate(() => ({
      page: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
    }));
    expect(widths.page, url).toBeLessThanOrEqual(widths.viewport);
  }
});

for (const leftHanded of [false, true]) {
  test(`practice panels stay inside a narrow or wide window${leftHanded ? ', left-handed' : ''} (P2-15)`, async ({
    page,
  }) => {
    if (leftHanded) {
      await page.goto('./#/settings');
      await page.getByLabel(/Left-handed layout/).check();
    }
    for (const width of [360, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('./#/practice/catalogue/ode-to-joy');
      await expect(page.getByRole('button', { name: 'Options' })).toBeVisible();
      const triggers = page.locator('.popover > button');
      for (let i = 0; i < (await triggers.count()); i++) {
        const trigger = triggers.nth(i);
        if (!(await trigger.isVisible())) continue;
        await trigger.click();
        const panel = page.locator('.popover__panel');
        await expect(panel).toBeVisible();
        const box = await panel.boundingBox();
        const name = `${width} px, ${(await trigger.getAttribute('aria-label')) ?? (await trigger.textContent())}`;
        expect(box!.x, name).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width, name).toBeLessThanOrEqual(width);
        await page.keyboard.press('Escape');
        await expect(panel).toHaveCount(0);
      }
    }
  });
}

test('a library piece opens in the key it was last moved to (P5-04)', async ({ page }) => {
  await importMidi(page, 'My scale');
  await page.getByRole('button', { name: 'Options' }).click();
  await page.getByRole('button', { name: 'Up a semitone' }).click();
  await expect(page.getByTestId('transpose')).toHaveText('+1');
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('opentiles:setting:pieceShifts')))
    .toMatch(/^\{"library:\d+:scale\.mid":1\}$/);
  await page.reload();
  await page.getByRole('button', { name: 'Options' }).click();
  await expect(page.getByTestId('transpose')).toHaveText('+1');
});
