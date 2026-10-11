import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// MIDI keyboards through Web MIDI, with a stand-in keyboard: the page gets a fake
// navigator.requestMIDIAccess with one input and one output called "Test Keyboard". Notes are
// "played" with window.__midiPress, everything the app sends is kept in window.__midiSent, and
// window.__midiRequests counts the requests for access. window.__midiStateChange fires the
// access's statechange, as browsers do when a port opens or a keyboard comes or goes.
async function fakeKeyboard(page: Page, { firstRequestHangs = false } = {}) {
  await page.addInitScript((hangs: boolean) => {
    const w = window as unknown as {
      __midiSent: number[][];
      __midiPress: (pitch: number) => void;
      __midiRequests: number;
      __midiStateChange: () => void;
    };
    w.__midiSent = [];
    w.__midiRequests = 0;
    const input = Object.assign(new EventTarget(), {
      id: 'in',
      name: 'Test Keyboard',
      state: 'connected',
      connection: 'closed',
      open: async () => {
        input.connection = 'open';
        return input;
      },
    });
    const message = (data: number[]) =>
      Object.defineProperty(new Event('midimessage'), 'data', { value: new Uint8Array(data) });
    const output = {
      id: 'out',
      name: 'Test Keyboard',
      state: 'connected',
      connection: 'closed',
      send: (data: number[]) => {
        w.__midiSent.push([...data]);
        // The first note out opens the port, and the browser says so.
        if (output.connection !== 'open') {
          output.connection = 'open';
          w.__midiStateChange();
        }
      },
      clear: () => {},
      open: async () => output,
    };
    w.__midiPress = (pitch: number) => {
      input.dispatchEvent(message([0x90, pitch, 100]));
      setTimeout(() => input.dispatchEvent(message([0x80, pitch, 0])), 100);
    };
    const accesses: EventTarget[] = [];
    w.__midiStateChange = () => {
      for (const a of accesses) a.dispatchEvent(new Event('statechange'));
    };
    Object.defineProperty(navigator, 'requestMIDIAccess', {
      configurable: true,
      value: async () => {
        w.__midiRequests += 1;
        // Like a permission prompt the learner never answers.
        if (hangs && w.__midiRequests === 1) await new Promise(() => {});
        const access = Object.assign(new EventTarget(), {
          inputs: new Map([['in', input]]),
          outputs: new Map([['out', output]]),
        });
        accesses.push(access);
        return access;
      },
    });
  }, firstRequestHangs);
}

const sent = (page: Page) =>
  page.evaluate(() => (window as unknown as { __midiSent: number[][] }).__midiSent);

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
