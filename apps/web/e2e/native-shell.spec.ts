import { expect, test } from '@playwright/test';

// The iPad app (apps/ios-shell) cannot run here, so this stands in for Capacitor's native bridge:
// the globals it injects before page scripts, a CoreMIDI plugin header, and the two calls
// @capacitor/core makes into native code. Everything on the web side is real: shell detection,
// the lazily loaded plugin chunk, @capacitor/core's plugin proxy and NativeMidiInput.
declare global {
  interface Window {
    fakeMidi: {
      calls: string[];
      emit: (eventName: string, data: unknown) => void;
      hostTime: () => number;
    };
  }
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    type Callback = (data: unknown) => void;
    const listeners = new Map<string, { eventName: string; callback: Callback }>();
    const calls: string[] = [];
    let nextId = 1;
    // The host clock runs far ahead of performance.now(), as mach_absolute_time() does.
    const hostTime = () => performance.now() / 1000 + 86_400;
    const sources = [{ id: 1, name: 'Test Piano' }];
    const methods = ['listSources', 'start', 'stop', 'getTime'].map((name) => ({
      name,
      rtype: 'promise',
    }));
    const w = window as unknown as Record<string, unknown>;
    // A custom platform makes @capacitor/core report a native platform once it loads.
    w.CapacitorCustomPlatform = { name: 'ios', plugins: {} };
    w.Capacitor = {
      isNativePlatform: () => true,
      isPluginAvailable: (name: string) => name === 'CoreMidi',
      PluginHeaders: [
        {
          name: 'CoreMidi',
          methods: [
            { name: 'addListener' },
            { name: 'removeListener' },
            { name: 'removeAllListeners', rtype: 'promise' },
            ...methods,
          ],
        },
      ],
      nativePromise: async (_plugin: string, method: string) => {
        calls.push(method);
        if (method === 'getTime') return { time: hostTime() };
        if (method === 'start' || method === 'listSources') return { sources };
        return {};
      },
      nativeCallback: (
        _plugin: string,
        method: string,
        options: { eventName: string; callbackId?: string },
        callback: Callback,
      ) => {
        calls.push(method);
        if (method === 'removeListener') {
          if (options.callbackId) listeners.delete(options.callbackId);
          return '';
        }
        const id = String(nextId++);
        listeners.set(id, { eventName: options.eventName, callback });
        return id;
      },
    };
    window.fakeMidi = {
      calls,
      hostTime,
      emit: (eventName, data) => {
        for (const l of listeners.values()) if (l.eventName === eventName) l.callback(data);
      },
    };
  });
});

test('inside the iPad app, a CoreMIDI keyboard drives wait mode', async ({ page }) => {
  await page.goto('./#/practice/catalogue/ode-to-joy');
  await expect(page.locator('canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Right', exact: true }).click();
  await expect(page.getByText('MIDI not available')).toHaveCount(0);

  await page.getByRole('button', { name: 'Connect MIDI keyboard' }).click();
  await expect(page.getByText('MIDI: Test Piano')).toBeVisible();
  const calls = await page.evaluate(() => window.fakeMidi.calls);
  expect(calls).toContain('getTime');
  expect(calls).toContain('start');

  const stats = page.locator('.stats');
  await expect(stats).toContainText('Step 1/');
  const note = (pitch: number) =>
    page.evaluate((p) => {
      const time = window.fakeMidi.hostTime();
      window.fakeMidi.emit('noteOn', { pitch: p, velocity: 80, channel: 0, time });
      window.fakeMidi.emit('noteOff', { pitch: p, velocity: 0, channel: 0, time: time + 0.1 });
    }, pitch);
  await note(64); // E4, the first note of the right hand
  await expect(stats).toContainText('Step 2/');
  await note(65); // F4: wrong, E4 is expected again
  await expect(stats).toContainText('✗ 1');

  await page.evaluate(() =>
    window.fakeMidi.emit('devicesChanged', { sources: [{ id: 2, name: 'Other Keyboard' }] }),
  );
  await expect(page.getByText('MIDI: Other Keyboard')).toBeVisible();
});

test('a browser without the app never loads Capacitor', async ({ page }) => {
  const scripts: Promise<string>[] = [];
  page.on('response', (r) => {
    if (r.url().endsWith('.js')) scripts.push(r.text());
  });
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    delete w.Capacitor;
    delete w.CapacitorCustomPlatform;
  });
  await page.goto('./#/practice/catalogue/ode-to-joy');
  await expect(page.locator('canvas')).toBeVisible();
  const bodies = await Promise.all(scripts);
  expect(bodies.length).toBeGreaterThan(0);
  // Only the lazily loaded plugin chunk (@capacitor/core) mentions CapacitorCustomPlatform.
  expect(bodies.some((b) => b.includes('CapacitorCustomPlatform'))).toBe(false);
});
