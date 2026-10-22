// The on-screen and computer keys: a key pressed before sound has started waits for it, and its
// release waits with it.
import { describe, expect, it } from 'vitest';
import { TouchInput } from '../src/input/touch-input';

function keys() {
  const input = new TouchInput();
  const log: string[] = [];
  input.onNote = (e) => log.push(`on ${e.pitch}`);
  input.onRelease = (pitch) => log.push(`off ${pitch}`);
  return { input, log };
}

describe('touch input', () => {
  it('plays at once when nothing has to start first', () => {
    const { input, log } = keys();
    input.press(60);
    input.release(60);
    expect(log).toEqual(['on 60', 'off 60']);
  });

  it('holds a key and its release until sound has started, even a quick tap', async () => {
    const { input, log } = keys();
    let started = () => {};
    const sound = new Promise<void>((resolve) => (started = resolve));
    input.waitFor = () => sound;
    input.press(60);
    input.release(60);
    expect(log).toEqual([]);
    started();
    await new Promise((r) => setTimeout(r, 0));
    expect(log).toEqual(['on 60', 'off 60']);
  });

  it('keeps the order of keys pressed while waiting, a repeated key included', async () => {
    const { input, log } = keys();
    let started = () => {};
    const sound = new Promise<void>((resolve) => (started = resolve));
    input.waitFor = () => sound;
    input.press(64);
    input.release(64);
    input.press(64);
    input.release(64);
    input.press(65);
    started();
    await new Promise((r) => setTimeout(r, 0));
    expect(log).toEqual(['on 64', 'off 64', 'on 64', 'off 64', 'on 65']);
    input.waitFor = () => null;
    input.release(65);
    expect(log.at(-1)).toBe('off 65');
  });

  it('plays the key when sound fails to start', async () => {
    const { input, log } = keys();
    const failed = Promise.reject(new Error('no audio'));
    input.waitFor = () => failed;
    input.press(62);
    await failed.catch(() => {});
    await new Promise((r) => setTimeout(r, 0));
    expect(log).toEqual(['on 62']);
    input.release(62);
    expect(log).toEqual(['on 62', 'off 62']);
  });
});
