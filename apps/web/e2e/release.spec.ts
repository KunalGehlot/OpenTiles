import { expect, test } from '@playwright/test';

// Things a public release depends on: searching the piece list, remembering the learner's choices
// on this device, and a Content-Security-Policy that blocks nothing the app needs.

test('the piece list can be searched, ignoring case and accents', async ({ page }) => {
  await page.goto('./');
  const search = page.getByRole('searchbox', { name: 'Search pieces' });
  await expect(page.locator('.piece:visible')).not.toHaveCount(0);
  const all = await page.locator('.piece:visible').count();
  await search.fill('FUR elise');
  await expect(page.locator('.piece:visible').first()).toContainText('Für Elise');
  expect(await page.locator('.piece:visible').count()).toBeLessThan(all);
  await search.fill('beethoven');
  await expect(page.getByRole('status')).toContainText(/pieces? found/);
  await search.fill('zzzz nothing');
  await expect(page.getByRole('status')).toContainText('No piece matches');
  await expect(page.locator('.piece:visible')).toHaveCount(0);
  await search.fill('');
  await expect(page.locator('.piece:visible')).toHaveCount(all);
});

test('practice choices and settings are remembered on this device', async ({ page }) => {
  await page.goto('./#/practice/catalogue/ode-to-joy');
  await page.getByRole('button', { name: 'Listen', exact: true }).click();
  await page.getByRole('button', { name: 'Right', exact: true }).click();
  const tempo = page.getByRole('slider', { name: /tempo/i });
  await tempo.fill('70');
  await page.getByRole('button', { name: 'Metronome' }).click();
  // Give the (queued) saves a moment, then start from scratch with the same browser profile.
  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Listen', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('button', { name: 'Right', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('.tempo__value')).toHaveText('70 %');
  await expect(page.getByRole('button', { name: 'Metronome' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  // The same choices apply to another piece.
  await page.goto('./#/practice/catalogue/twinkle-twinkle');
  await expect(page.getByRole('button', { name: 'Listen', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('damaged saved choices fall back to the defaults', async ({ page }) => {
  await page.goto('./');
  await page.evaluate(() => {
    localStorage.setItem(
      'opentiles:setting:practicePrefs',
      JSON.stringify({ mode: 'nonsense', tempo: 99, hands: 7 }),
    );
  });
  // IndexedDB wins when it has a value, so clear it to exercise the localStorage copy.
  await page.evaluate(() => indexedDB.deleteDatabase('opentiles'));
  await page.goto('./#/practice/catalogue/ode-to-joy');
  await expect(page.getByRole('button', { name: 'Wait', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('.tempo__value')).toHaveText('150 %');
});

test('the Content-Security-Policy blocks nothing the app needs', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/content security policy|refused to/i.test(m.text())) violations.push(m.text());
  });
  page.on('pageerror', (e) => violations.push(String(e)));
  await page.goto('./');
  await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveCount(1);
  await page.goto('./#/practice/catalogue/ode-to-joy');
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Score' }).click();
  await expect(page.locator('[data-testid="score-strip"] > svg')).toBeVisible({ timeout: 20_000 });
  await page.keyboard.press('KeyD');
  await page.goto('./#/settings');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  expect(violations).toEqual([]);
});

test('note names can be switched off and stay off after a reload', async ({ page }) => {
  await page.goto('./#/settings');
  const toggle = page.getByLabel('Note names', { exact: false });
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await page.waitForTimeout(400);
  await page.reload();
  await expect(page.getByLabel('Note names', { exact: false })).not.toBeChecked();
});
