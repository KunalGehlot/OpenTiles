import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// Installable app and offline practice (PLAN.md P1-23).

// Other specs block service workers (playwright.config.ts); these tests are about them.
test.use({ serviceWorkers: 'allow' });

/** Resolves once the service worker has precached the app and controls the page. */
async function serviceWorkerReady(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((r) =>
        navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }),
      );
    }
  });
}

test('the manifest makes OpenTiles installable', async ({ page, request }) => {
  await page.goto('./');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBeTruthy();
  const manifest = (await (await request.get(href ?? '')).json()) as {
    name: string;
    display: string;
    start_url: string;
    icons: { src: string; sizes: string; purpose?: string }[];
  };
  expect(manifest).toMatchObject({ name: 'OpenTiles', display: 'standalone', start_url: './' });
  expect(manifest.icons.map((i) => i.sizes)).toEqual(
    expect.arrayContaining(['192x192', '512x512']),
  );
  expect(manifest.icons.some((i) => i.purpose === 'maskable')).toBe(true);
  for (const icon of manifest.icons) expect((await request.get(icon.src)).ok()).toBe(true);
  const touchIcon = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href');
  expect(touchIcon).toBe('./apple-touch-icon.png');
  expect((await request.get(touchIcon ?? '')).ok()).toBe(true);
});

test('the service worker precaches the engine, the worklet and the catalogue', async ({
  page,
  request,
}) => {
  await page.goto('./');
  const sw = await (await request.get('./sw.js')).text();
  for (const needle of [
    'index.html',
    'manifest.webmanifest',
    'catalogue/index.json',
    'catalogue/pieces/ode-to-joy/score.musicxml',
    'apple-touch-icon.png',
  ]) {
    expect(sw, needle).toContain(`"${needle}"`);
  }
  expect(sw).toMatch(/"assets\/engine-[\w-]+\.wasm"/);
  expect(sw).toMatch(/"assets\/detector-worklet-[\w-]+\.js"/);
  expect(sw).not.toMatch(/\.map"/);
});

test('practice works offline after the first visit', async ({ page, context, browserName }) => {
  test.skip(
    browserName !== 'chromium',
    'Offline emulation of service-worker traffic is verified on Chromium only so far',
  );
  await page.goto('./');
  await expect(page.locator('.card h3', { hasText: 'Ode to Joy (theme)' })).toBeVisible();
  await serviceWorkerReady(page);

  await context.setOffline(true);
  try {
    // Make sure the network really is gone: an uncached file must fail.
    const probe = await page.evaluate(() =>
      fetch(`./not-cached-${Date.now()}.txt`).then(
        () => 'online',
        () => 'offline',
      ),
    );
    expect(probe).toBe('offline');

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Free piano practice' })).toBeVisible();
    await page.locator('.card', { hasText: 'Ode to Joy (theme)' }).click();
    await expect(page.locator('canvas')).toBeVisible();
    await page.getByRole('button', { name: 'Right', exact: true }).click();
    const stats = page.locator('.stats');
    await expect(stats).toContainText('Step 1/');
    await page.keyboard.press('KeyD'); // E4
    await expect(stats).toContainText('Step 2/');

    // The detector (wasm in an AudioWorklet) loads from the cache too.
    await page.getByRole('button', { name: 'Use microphone' }).click();
    // First use of the microphone offers the guided set-up (P1-20); skip it here.
    await page
      .getByRole('dialog', { name: 'Microphone set-up' })
      .getByRole('button', { name: 'Skip', exact: true })
      .click({ timeout: 10_000 });
    await expect(page.getByText('Microphone listening')).toBeVisible({ timeout: 10_000 });
  } finally {
    await context.setOffline(false);
  }
});

test('a new version is offered, never forced', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Service-worker updates are verified on Chromium only');
  // Simulates a deployment by changing the worker the local preview server serves.
  const swFile = resolve(import.meta.dirname, '../dist/sw.js');
  test.skip(!existsSync(swFile), 'Needs the local preview build');

  await page.goto('./');
  await serviceWorkerReady(page);
  const bar = page.getByRole('status').filter({ hasText: 'Update available' });
  await expect(bar).toBeHidden();

  const original = readFileSync(swFile, 'utf8');
  try {
    writeFileSync(swFile, `${original}\n// e2e: a new deployment\n`);
    await page.evaluate(async () => {
      await (await navigator.serviceWorker.ready).update();
    });
    await expect(bar).toBeVisible();

    // Dismissing hides the bar for this visit; nothing reloads behind the user's back.
    await page.evaluate(() => ((window as unknown as { marker: number }).marker = 1));
    await bar.getByRole('button', { name: 'Dismiss' }).click();
    await expect(bar).toBeHidden();
    expect(await page.evaluate(() => (window as unknown as { marker?: number }).marker)).toBe(1);

    // The new version is still waiting on the next visit; accepting it reloads into it.
    await page.reload();
    await expect(bar).toBeVisible();
    await Promise.all([
      page.waitForEvent('load'),
      bar.getByRole('button', { name: 'Reload' }).click(),
    ]);
    await expect(page.getByRole('heading', { name: 'Free piano practice' })).toBeVisible();
    await expect(bar).toBeHidden();
    const waiting = await page.evaluate(
      async () => (await navigator.serviceWorker.ready).waiting !== null,
    );
    expect(waiting).toBe(false);
  } finally {
    writeFileSync(swFile, original);
  }
});

test.describe('on iPad Safari in a browser tab', () => {
  test.use({
    userAgent:
      'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    viewport: { width: 820, height: 1180 },
    hasTouch: true,
  });

  test('the Home page explains how to add OpenTiles to the Home Screen', async ({ page }) => {
    await page.goto('./');
    const hint = page.getByRole('complementary', { name: 'Add OpenTiles to your Home Screen' });
    await expect(hint).toBeVisible();
    await expect(hint).toContainText('Add to Home Screen');
    await expect(hint).toContainText('seven days');
    await hint.getByRole('button', { name: 'Got it' }).click();
    await expect(hint).toBeHidden();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Free piano practice' })).toBeVisible();
    await expect(hint).toBeHidden();
  });
});

test('desktop browsers get no Home Screen hint', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'ipad', 'The iPad profile is meant to see the hint');
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Free piano practice' })).toBeVisible();
  await expect(page.getByRole('complementary', { name: /Home Screen/ })).toHaveCount(0);
});
