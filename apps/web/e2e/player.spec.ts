// The Player (P6-07, ADR 0019): the catalogue and the library in one list, played on this device
// or on a stand-in MIDI keyboard, on other pages too; practice takes the sound over. Pieces are
// the CC0 catalogue and a MIDI file generated in sheet-import-fixtures.ts.
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { deviceNotes, fakeKeyboard, noteOns, sent, unendedNotes } from './fake-midi';
import { tinyMidi } from './sheet-import-fixtures';

const title = (page: Page) => page.locator('.np-text h2').first();
const playButton = (page: Page) => page.locator('.np-play');

async function importTinyMidi(page: Page, name: string) {
  await page.goto('./#/library');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import a file…' }).click();
  await page.getByRole('checkbox', { name: /I only import files/ }).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await (await chooser).setFiles([{ name, mimeType: 'audio/midi', buffer: tinyMidi() }]);
  await page.getByRole('button', { name: 'Save to my library' }).click();
  await expect(page).toHaveURL(/#\/practice\/library\//);
}

async function playOnKeyboard(page: Page) {
  await page.getByRole('button', { name: /^Plays on/ }).click();
  await page.getByRole('radio', { name: 'My keyboard' }).check();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Plays on: My keyboard' })).not.toHaveClass(
    /plays-on--warn/,
  );
}

test('lists the catalogue and the library together, with search and filters', async ({ page }) => {
  await importTinyMidi(page, 'Little Study.mid');
  await page.goto('./#/player');
  const list = page.locator('.collection__list');
  await expect(list.getByText('Ode to Joy (full tune)')).toBeVisible();
  await expect(list.getByText('Little Study')).toBeVisible();
  await page
    .getByRole('group', { name: 'Show' })
    .getByRole('button', { name: 'My library' })
    .click();
  await expect(list.locator('.collection__title')).toHaveText(['Little Study']);
  await page.getByRole('group', { name: 'Show' }).getByRole('button', { name: 'All' }).click();
  await page.getByRole('searchbox', { name: 'Search all music' }).fill('ode joy');
  await expect(list.locator('.collection__title').first()).toContainText('Ode to Joy');
});

test('plays on the keyboard: play, pause and next send notes there, and none on this device', async ({
  page,
}) => {
  await fakeKeyboard(page);
  await page.goto('./#/player');
  await expect(title(page)).toHaveText('Ode to Joy (full tune)');
  await playOnKeyboard(page);
  await playButton(page).click();
  await expect.poll(() => noteOns(page), { timeout: 10_000 }).toBeGreaterThan(2);
  expect(await deviceNotes(page)).toBe(0);
  await expect(page.locator('.np-seek__time').first()).not.toHaveText('0:00');

  // Pause: everything sounding ends, and nothing more arrives.
  await page.keyboard.press('Space');
  await expect(playButton(page)).toHaveAttribute('aria-label', 'Play');
  await page.waitForTimeout(400);
  const paused = await sent(page);
  expect(unendedNotes(paused)).toEqual([]);
  await page.waitForTimeout(800);
  expect((await sent(page)).length).toBe(paused.length);

  // Next: the following piece in the list, playing.
  await page.keyboard.press('Space');
  await page.getByRole('button', { name: 'Next piece' }).click();
  await expect(title(page)).not.toHaveText('Ode to Joy (full tune)');
  const before = await noteOns(page);
  await expect.poll(() => noteOns(page), { timeout: 10_000 }).toBeGreaterThan(before);
});

test('plays on the keyboard’s own sound by default once it is connected', async ({ page }) => {
  await fakeKeyboard(page);
  await page.goto('./#/player');
  await expect(title(page)).toHaveText('Ode to Joy (full tune)');
  await page.getByRole('button', { name: 'Play on your piano' }).click();
  await expect(page.getByRole('button', { name: 'Plays on: Test Keyboard' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play on your piano' })).toHaveCount(0);
  await playButton(page).click();
  await expect.poll(() => noteOns(page), { timeout: 10_000 }).toBeGreaterThan(2);
  expect(await deviceNotes(page)).toBe(0);
  await page.keyboard.press('Space');
});

test('plays on this device where there is no MIDI', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { value: undefined });
    const w = window as unknown as { __deviceNotes: number };
    w.__deviceNotes = 0;
    for (const Node of [OscillatorNode, AudioBufferSourceNode]) {
      const start = Node.prototype.start as (...a: unknown[]) => void;
      Node.prototype.start = function (this: AudioScheduledSourceNode, ...args: unknown[]) {
        if (!(this instanceof OscillatorNode && [1320, 1760].includes(this.frequency.value))) {
          w.__deviceNotes += 1;
        }
        start.apply(this, args);
      };
    }
  });
  await page.goto('./#/player');
  await expect(page.getByRole('button', { name: 'Plays on: This device' })).toBeVisible();
  await playButton(page).click();
  await expect.poll(() => deviceNotes(page), { timeout: 10_000 }).toBeGreaterThan(0);
});

test('keeps playing on other pages, and practice takes the sound over', async ({ page }) => {
  await fakeKeyboard(page);
  await page.goto('./#/player');
  await playOnKeyboard(page);
  await playButton(page).click();
  await expect.poll(() => noteOns(page), { timeout: 10_000 }).toBeGreaterThan(1);

  // Home, then the Library: the notes go on, and the bar along the bottom shows the piece.
  await page.getByRole('link', { name: 'Pieces' }).click();
  await page.getByRole('link', { name: 'My library', exact: true }).click();
  const there = await noteOns(page);
  await expect.poll(() => noteOns(page), { timeout: 10_000 }).toBeGreaterThan(there);
  const bar = page.locator('.shell-player');
  await expect(bar).toContainText('Ode to Joy (full tune)');

  // Its Pause ends everything sounding; its Play goes on.
  await bar.getByRole('button', { name: 'Pause' }).click();
  await page.waitForTimeout(400);
  expect(unendedNotes(await sent(page))).toEqual([]);
  await bar.getByRole('button', { name: 'Play' }).click();
  const resumed = await noteOns(page);
  await expect.poll(() => noteOns(page), { timeout: 10_000 }).toBeGreaterThan(resumed);

  // Practice stops it, and the bar says so afterwards.
  await page.evaluate(() => (location.hash = '#/practice/catalogue/twinkle-twinkle'));
  await expect(page.locator('.stats')).toBeVisible();
  await expect(bar).toHaveCount(0);
  await page.waitForTimeout(500);
  const stopped = await sent(page);
  expect(unendedNotes(stopped)).toEqual([]);
  await page.waitForTimeout(1000);
  expect(await noteOns(page)).toBe(stopped.filter((m) => m[0] === 0x90).length);
  await page.evaluate(() => (location.hash = '#/library'));
  await expect(bar).toContainText('Stopped while you practise.');
  await expect(bar.getByRole('button', { name: 'Play' })).toBeVisible();

  // A tap on the piece opens the Player, where the bar gives way to the Player's own controls.
  await bar.getByRole('link').click();
  await expect(page).toHaveURL(/#\/player/);
  await expect(bar).toHaveCount(0);
  await expect(page.getByTestId('player-message')).toHaveText('Stopped while you practise.');
});

test('a page where the Player was never opened shows no bar and makes no Player', async ({
  page,
}) => {
  // Making the Player hands the device's media controls their actions: count those.
  await page.addInitScript(() => {
    const w = window as unknown as { __handlers: number };
    w.__handlers = 0;
    // On the prototype: WebKit may make navigator.mediaSession's object afresh, without a patch.
    if (typeof MediaSession === 'undefined') return;
    const set = MediaSession.prototype.setActionHandler;
    MediaSession.prototype.setActionHandler = function (this: MediaSession, action, handler) {
      w.__handlers += 1;
      set.call(this, action, handler);
    };
  });
  const handlers = () =>
    page.evaluate(() => (window as unknown as { __handlers: number }).__handlers);
  await page.goto('./#/library');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.getByRole('link', { name: 'Pieces' }).click();
  await expect(page.locator('.shell-player')).toHaveCount(0);
  expect(await handlers()).toBe(0);
  // The check itself works where there are media controls: opening the Player makes it.
  await page.getByRole('link', { name: 'Player', exact: true }).click();
  await expect(title(page)).toBeVisible();
  const controls = await page.evaluate(
    () => 'mediaSession' in navigator && typeof MediaMetadata !== 'undefined',
  );
  if (controls) expect(await handlers()).toBeGreaterThan(0);
});

test('moves with the seek picture and the arrow keys', async ({ page }) => {
  await page.goto('./#/player');
  await expect(title(page)).toBeVisible();
  const seek = page.getByRole('slider', { name: 'Position' });
  const box = await seek.boundingBox();
  if (!box) throw new Error('no seek bar');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  // The slider's value follows on the next frame.
  await expect
    .poll(async () => Number(await seek.getAttribute('aria-valuenow')))
    .toBeGreaterThan(0);
  await seek.focus();
  await page.keyboard.press('Home');
  await expect(seek).toHaveAttribute('aria-valuenow', '0');
  await expect(seek).toHaveAttribute('aria-valuetext', /^0:00 of \d+:\d\d$/);
});

for (const size of [
  { width: 320, height: 768 },
  { width: 1180, height: 820 },
]) {
  test(`fits a ${size.width} px window without scrolling sideways`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto('./#/player');
    await expect(page.locator('.collection__row').first()).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    if (size.width < 760) await expect(page.locator('.minibar')).toBeVisible();
    else await expect(page.getByRole('region', { name: 'Now playing' }).first()).toBeVisible();
  });
}
