import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// MIDI keyboards through Web MIDI, with a stand-in keyboard: the page gets a fake
// navigator.requestMIDIAccess with one input and one output called "Test Keyboard". Notes are
// "played" with window.__midiPress, everything the app sends is kept in window.__midiSent, and
// window.__midiRequests counts the requests for access.
async function fakeKeyboard(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as {
      __midiSent: number[][];
      __midiPress: (pitch: number) => void;
      __midiRequests: number;
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
      connection: 'open',
      send: (data: number[]) => w.__midiSent.push([...data]),
      clear: () => {},
      open: async () => output,
    };
    w.__midiPress = (pitch: number) => {
      input.dispatchEvent(message([0x90, pitch, 100]));
      setTimeout(() => input.dispatchEvent(message([0x80, pitch, 0])), 100);
    };
    Object.defineProperty(navigator, 'requestMIDIAccess', {
      configurable: true,
      value: async () => {
        w.__midiRequests += 1;
        return Object.assign(new EventTarget(), {
          inputs: new Map([['in', input]]),
          outputs: new Map([['out', output]]),
        });
      },
    });
  });
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

  for (const piece of ['twinkle-twinkle', 'ode-to-joy']) {
    await go(`#/practice/catalogue/${piece}`);
    await page.getByRole('button', { name: 'Connect MIDI keyboard' }).click();
    await expect(page.getByText('MIDI: Test Keyboard')).toBeVisible();
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
