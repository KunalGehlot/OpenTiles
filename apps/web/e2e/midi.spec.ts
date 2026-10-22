import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { deviceNotes, fakeKeyboard, noteOns, sent, unendedNotes } from './fake-midi';

/** Opens "Plays on" and picks a choice. */
async function playOn(page: Page, choice: 'This device' | 'My keyboard' | 'Both') {
  await page.getByRole('button', { name: /^Plays on/ }).click();
  await page.getByRole('radio', { name: choice }).check();
  await page.keyboard.press('Escape');
}

test('Settings tests the keyboard: what it plays shows up, and a test note goes out', async ({
  page,
}) => {
  await fakeKeyboard(page);
  await page.goto('./#/settings');
  const section = page.locator('section', {
    has: page.getByRole('heading', { name: 'MIDI keyboard' }),
  });
  await section.getByRole('button', { name: 'Test', exact: true }).click();
  await expect(section.getByTestId('midi-test')).toContainText('Keyboards: Test Keyboard');
  await page.evaluate(() =>
    (window as unknown as { __midiPress: (p: number) => void }).__midiPress(60),
  );
  await expect(section.getByTestId('midi-test')).toContainText('Last note: C4 (100)');
  await section.getByRole('button', { name: 'Play a test note on it' }).click();
  await expect
    .poll(async () => (await sent(page)).some((m) => m[0] === 0x90 && m[1] === 60))
    .toBe(true);
});

test('the app’s notes can play on the MIDI keyboard, and Stop silences it', async ({ page }) => {
  await fakeKeyboard(page);
  await page.goto('./#/settings');
  await page.getByRole('combobox', { name: 'App’s notes play on' }).selectOption('keyboard');
  await page.goto('./#/practice/catalogue/ode-to-joy');
  await page.getByRole('button', { name: 'Connect MIDI keyboard' }).click();
  await expect(page.getByText('MIDI: Test Keyboard')).toBeVisible();
  // MIDI keys move wait mode on, like any keys (the first step is E4 and C3).
  await page.evaluate(() => {
    const press = (window as unknown as { __midiPress: (p: number) => void }).__midiPress;
    press(64);
    press(48);
  });
  await expect(page.locator('.stats')).toContainText('Step 2/');
  await page.getByRole('button', { name: 'Listen', exact: true }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect
    .poll(async () => (await sent(page)).filter((m) => m[0] === 0x90).length, { timeout: 10_000 })
    .toBeGreaterThan(2);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect
    .poll(async () => (await sent(page)).some((m) => m[0] === 0xb0 && m[1] === 123))
    .toBe(true);
});

// Firefox closes a device for the whole page when any access's port objects are collected, and
// on a Mac may not find it again until it restarts, so the app asks for access once (P5-12).
test('one MIDI connection serves every screen, so the keyboard stays after moving around', async ({
  page,
}) => {
  await fakeKeyboard(page);
  const press = (pitch: number) =>
    page.evaluate(
      (p) => (window as unknown as { __midiPress: (p: number) => void }).__midiPress(p),
      pitch,
    );
  const go = (hash: string) => page.evaluate((h) => (location.hash = h), hash);
  await page.goto('./#/settings');
  const section = page.locator('section', {
    has: page.getByRole('heading', { name: 'MIDI keyboard' }),
  });
  await section.getByRole('button', { name: 'Test', exact: true }).click();
  await press(60);
  await expect(section.getByTestId('midi-test')).toContainText('Last note: C4 (100)');

  // Access was granted in Settings, so every piece connects by itself.
  for (const piece of ['twinkle-twinkle', 'ode-to-joy']) {
    await go(`#/practice/catalogue/${piece}`);
    await expect(page.getByText('MIDI: Test Keyboard')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Connect MIDI keyboard' })).toHaveCount(0);
  }
  // Ode to Joy's first step (E4 and C3), played on the keyboard, moves wait mode on.
  await press(64);
  await press(48);
  await expect(page.locator('.stats')).toContainText('Step 2/');

  await go('#/settings');
  await section.getByRole('button', { name: 'Test', exact: true }).click();
  await press(62);
  await expect(section.getByTestId('midi-test')).toContainText('Last note: D4 (100)');
  expect(
    await page.evaluate(() => (window as unknown as { __midiRequests: number }).__midiRequests),
  ).toBe(1);
});

// Chrome and Firefox ask before giving a page MIDI, and nothing happens until the learner answers.
test('a MIDI request waiting on the browser says where to allow it, and Connect asks again', async ({
  page,
}) => {
  await fakeKeyboard(page, { firstRequestHangs: true });
  await page.goto('./#/practice/catalogue/ode-to-joy');
  await page.getByRole('button', { name: 'Connect MIDI keyboard' }).click();
  await expect(page.getByTestId('midi-waiting')).toContainText('address bar');
  await page.getByRole('button', { name: 'Waiting for the browser…' }).click();
  await expect(page.getByText('MIDI: Test Keyboard')).toBeVisible();
  await expect(page.getByTestId('midi-waiting')).toHaveCount(0);
});

// A port opening, a keyboard coming or going, or the app's first note out all fire statechange;
// the practice screen used to take that for a new connection and stop the input it was using,
// while still saying it was connected (maintainer's report, 2026-10-11).
test('the keyboard keeps working after the browser reports a port change, and after playing on it', async ({
  page,
}) => {
  await fakeKeyboard(page);
  await page.goto('./#/settings');
  await page.getByRole('combobox', { name: 'App’s notes play on' }).selectOption('keyboard');
  await page.goto('./#/practice/catalogue/ode-to-joy');
  await page.getByRole('button', { name: 'Connect MIDI keyboard' }).click();
  await expect(page.getByText('MIDI: Test Keyboard')).toBeVisible();
  await page.evaluate(() =>
    (window as unknown as { __midiStateChange: () => void }).__midiStateChange(),
  );
  // Listen, play a little on the keyboard, stop, and practise again with the keys.
  await page.getByRole('button', { name: 'Listen', exact: true }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect
    .poll(async () => (await sent(page)).filter((m) => m[0] === 0x90).length, { timeout: 10_000 })
    .toBeGreaterThan(2);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await page.getByRole('button', { name: 'Wait', exact: true }).click();
  await page.evaluate(() => {
    const press = (window as unknown as { __midiPress: (p: number) => void }).__midiPress;
    press(64);
    press(48);
  });
  await expect(page.locator('.stats')).toContainText('Step 2/');
});

// P6-01: "Plays on" in the session bar. The maintainer wanted Listen to play on the keyboard only.
test('Plays on: my keyboard sends every note there and none on this device', async ({ page }) => {
  await fakeKeyboard(page);
  await page.goto('./#/practice/catalogue/ode-to-joy');
  await expect(page.getByRole('button', { name: 'Plays on: This device' })).toBeVisible();
  // Choosing the keyboard connects it, without looking for the MIDI button first.
  await playOn(page, 'My keyboard');
  await expect(page.getByText('MIDI: Test Keyboard')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Plays on: My keyboard' })).toBeVisible();
  await expect(page.getByTestId('plays-on-notice')).toHaveCount(0);
  await page.getByRole('button', { name: 'Listen', exact: true }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(() => noteOns(page), { timeout: 10_000 }).toBeGreaterThan(3);
  expect(await deviceNotes(page)).toBe(0);
  // Stop ends every note on the keyboard and lifts the pedal (P6-02).
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await page.waitForTimeout(500);
  const after = await sent(page);
  expect(unendedNotes(after)).toEqual([]);
  expect(after.some((m) => m[0] === 0xb0 && m[1] === 64 && m[2] === 0)).toBe(true);
  // Nothing more arrives once stopped.
  await page.waitForTimeout(700);
  expect((await sent(page)).length).toBe(after.length);
});

test('Plays on: with no output the notes play on this device and the screen says why', async ({
  page,
}) => {
  await fakeKeyboard(page, { output: false });
  await page.goto('./#/practice/catalogue/ode-to-joy');
  await playOn(page, 'My keyboard');
  await expect(page.getByText('MIDI: Test Keyboard')).toBeVisible();
  await expect(page.getByTestId('plays-on-notice')).toContainText('no MIDI output');
  await expect(page.getByRole('button', { name: 'Plays on: My keyboard' })).toHaveClass(
    /plays-on--warn/,
  );
  await page.getByRole('button', { name: 'Listen', exact: true }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(() => deviceNotes(page), { timeout: 10_000 }).toBeGreaterThan(0);
  // The keyboard's output appears during the run: the notes move to it by themselves.
  await page.evaluate(() =>
    (window as unknown as { __midiAddOutput: () => void }).__midiAddOutput(),
  );
  await expect(page.getByTestId('plays-on-notice')).toHaveCount(0);
  await expect.poll(() => noteOns(page), { timeout: 10_000 }).toBeGreaterThan(1);
  const onDevice = await deviceNotes(page);
  await page.waitForTimeout(1500);
  expect(await deviceNotes(page)).toBe(onDevice);
});

test('Plays on: without a connection it offers Connect, and the device plays meanwhile', async ({
  page,
}) => {
  await fakeKeyboard(page);
  await page.goto('./#/settings');
  await page.getByRole('combobox', { name: 'App’s notes play on' }).selectOption('keyboard');
  await page.goto('./#/practice/catalogue/ode-to-joy');
  const notice = page.getByTestId('plays-on-notice');
  await expect(notice).toContainText('isn’t connected');
  await notice.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByText('MIDI: Test Keyboard')).toBeVisible();
  await expect(notice).toHaveCount(0);
});

test('leaving practice during Listen leaves nothing sounding on the keyboard', async ({ page }) => {
  await fakeKeyboard(page);
  await page.goto('./#/practice/catalogue/ode-to-joy');
  await playOn(page, 'My keyboard');
  await expect(page.getByText('MIDI: Test Keyboard')).toBeVisible();
  await page.getByRole('button', { name: 'Listen', exact: true }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(() => noteOns(page), { timeout: 10_000 }).toBeGreaterThan(3);
  // The page going away (a reload, closing the tab) stops the run first.
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(() => noteOns(page), { timeout: 10_000 }).toBeGreaterThan(6);
  await page.getByRole('link', { name: 'Pieces' }).click();
  await page.waitForTimeout(1000);
  const after = await sent(page);
  expect(unendedNotes(after)).toEqual([]);
  expect(after.some((m) => m[0] === 0xb0 && m[1] === 123)).toBe(true);
});

// A keyboard that connects by itself and is played at once: the page sees no tap or click, so
// sound on this device cannot start, yet the keyboard needs none to play the other hand.
test('wait mode on the keyboard alone plays the other hand there, with nothing clicked', async ({
  page,
}) => {
  await fakeKeyboard(page);
  await page.addInitScript(() => {
    const permissions = navigator.permissions;
    const query = permissions.query.bind(permissions);
    permissions.query = (d: PermissionDescriptor) =>
      (d.name as string) === 'midi'
        ? Promise.resolve({ state: 'granted' } as PermissionStatus)
        : query(d);
    localStorage.setItem('opentiles:setting:practicePrefs', JSON.stringify({ hands: 'right' }));
  });
  await page.goto('./#/practice/catalogue/ode-to-joy');
  await expect(page.getByText('MIDI: Test Keyboard')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Right', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByLabel('Play other hand')).toBeChecked();
  // The right hand's first step is E4; the left hand's C3 sounds with it.
  await page.evaluate(() =>
    (window as unknown as { __midiPress: (p: number) => void }).__midiPress(64),
  );
  await expect(page.locator('.stats')).toContainText('Step 2/');
  await expect
    .poll(async () => (await sent(page)).some((m) => m[0] === 0x90 && m[1] === 48))
    .toBe(true);
});

test('Plays on offers only this device where there is no Web MIDI', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { value: undefined });
  });
  await page.goto('./#/practice/catalogue/ode-to-joy');
  await page.getByRole('button', { name: 'Plays on: This device' }).click();
  await expect(page.getByTestId('plays-on-unavailable')).toContainText('this device');
  await expect(page.getByRole('radio')).toHaveCount(0);
});
