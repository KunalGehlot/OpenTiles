import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// MIDI keyboards through Web MIDI, with a stand-in keyboard: the page gets a fake
// navigator.requestMIDIAccess with one input and one output called "Test Keyboard". Notes are
// "played" with window.__midiPress and everything the app sends is kept in window.__midiSent.
async function fakeKeyboard(page: Page) {
  await page.addInitScript(() => {
    type Handler = ((e: { data: Uint8Array; timeStamp: number }) => void) | null;
    const w = window as unknown as {
      __midiSent: number[][];
      __midiPress: (pitch: number) => void;
    };
    w.__midiSent = [];
    const input = {
      id: 'in',
      name: 'Test Keyboard',
      state: 'connected',
      connection: 'closed',
      onmidimessage: null as Handler,
      open: async () => {
        input.connection = 'open';
        return input;
      },
    };
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
      const timeStamp = performance.now();
      input.onmidimessage?.({ data: new Uint8Array([0x90, pitch, 100]), timeStamp });
      setTimeout(
        () =>
          input.onmidimessage?.({
            data: new Uint8Array([0x80, pitch, 0]),
            timeStamp: performance.now(),
          }),
        100,
      );
    };
    Object.defineProperty(navigator, 'requestMIDIAccess', {
      configurable: true,
      value: async () => ({
        inputs: new Map([['in', input]]),
        outputs: new Map([['out', output]]),
        onstatechange: null,
      }),
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
