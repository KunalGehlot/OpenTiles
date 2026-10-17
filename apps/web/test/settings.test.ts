import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_APP_SETTINGS,
  canvasLabelScale,
  effectiveAccessibility,
  normaliseSettings,
  pedalAction,
  pedalKeyLabel,
} from '../src/settings/model';
import {
  APP_SETTINGS_KEY,
  appSettings,
  labelScale,
  loadAppSettings,
  reloadAppSettings,
  updateAppSettings,
} from '../src/settings/store';
import { getSetting } from '../src/storage/db';
import { estimateBits, passphraseStrength } from '../src/lib/passphrase';
import { absoluteHref, href, parseHash } from '../src/lib/router';
import { audioProgressValue } from '../src/lib/audio-import';
import { normaliseServerUrl } from '../src/sync/config';

describe('settings model', () => {
  it('defaults to following the system and keeps crash reports off', () => {
    const s = normaliseSettings(undefined);
    expect(s).toEqual(normaliseSettings(DEFAULT_APP_SETTINGS));
    expect(s.crashReports).toBe(false);
    expect(s.highContrast).toBe('system');
    expect(s.reducedMotion).toBe('system');
    expect(s.pedal.enabled).toBe(false);
  });

  it('drops unknown and malformed values', () => {
    const s = normaliseSettings({
      language: 'fr',
      largePrint: 'yes',
      highContrast: 'on',
      pedal: { enabled: true, nextKey: '', previousKey: 'PageUp' },
      evil: '<script>',
    });
    expect(s.language).toBe('en');
    expect(s.largePrint).toBe(false);
    expect(s.highContrast).toBe('on');
    expect(s.pedal).toEqual({ enabled: true, nextKey: 'ArrowRight', previousKey: 'PageUp' });
    expect('evil' in s).toBe(false);
  });

  it('resolves "system" against prefers-contrast and prefers-reduced-motion', () => {
    const s = normaliseSettings({ highContrast: 'system', reducedMotion: 'off' });
    const media = { prefersMoreContrast: true, prefersReducedMotion: true };
    expect(effectiveAccessibility(s, media)).toMatchObject({
      highContrast: true,
      reducedMotion: false,
    });
    expect(
      effectiveAccessibility(normaliseSettings({ highContrast: 'on' }), {
        prefersMoreContrast: false,
        prefersReducedMotion: false,
      }).highContrast,
    ).toBe(true);
  });

  it('scales canvas labels under large print', () => {
    expect(canvasLabelScale({ largePrint: false })).toBe(1);
    expect(canvasLabelScale({ largePrint: true })).toBeGreaterThan(1);
  });

  it('maps pedal keys to page turns and ignores typing and shortcuts', () => {
    const pedal = { enabled: true, nextKey: 'PageDown', previousKey: 'PageUp' };
    expect(pedalAction(pedal, { key: 'PageDown' })).toBe('next');
    expect(pedalAction(pedal, { key: 'PageUp' })).toBe('previous');
    expect(pedalAction(pedal, { key: 'a' })).toBeNull();
    expect(pedalAction(pedal, { key: 'PageDown', repeat: true })).toBeNull();
    expect(pedalAction(pedal, { key: 'PageDown', ctrlKey: true })).toBeNull();
    expect(pedalAction(pedal, { key: 'PageDown', inTextField: true })).toBeNull();
    expect(pedalAction({ ...pedal, enabled: false }, { key: 'PageDown' })).toBeNull();
    expect(pedalKeyLabel(' ')).toBe('Space');
    expect(pedalKeyLabel('b')).toBe('B');
  });
});

describe('settings store', () => {
  it('persists settings in IndexedDB and reloads them', async () => {
    await loadAppSettings();
    expect(appSettings().largePrint).toBe(false);
    await updateAppSettings({ largePrint: true, leftHanded: true });
    expect(labelScale()).toBeGreaterThan(1);
    expect(
      await getSetting<{ largePrint: boolean }>(APP_SETTINGS_KEY, { largePrint: false }),
    ).toMatchObject({ largePrint: true, leftHanded: true });
    await reloadAppSettings();
    expect(appSettings()).toMatchObject({
      largePrint: true,
      leftHanded: true,
      crashReports: false,
    });
  });
});

describe('passphrase strength', () => {
  it('rates short, common and long passphrases', () => {
    expect(passphraseStrength('short').level).toBe(0);
    expect(passphraseStrength('password1').level).toBe(1);
    expect(passphraseStrength('abcdefgh').level).toBe(1);
    expect(passphraseStrength('violet tram cellar mango').level).toBe(3);
    expect(estimateBits('')).toBe(0);
    expect(estimateBits('aaaaaaaaaaaa')).toBeLessThan(estimateBits('a7#Kq2!zP9x@'));
  });
});

describe('router', () => {
  it('parses and builds the new routes', () => {
    expect(parseHash('#/settings')).toEqual({ name: 'settings' });
    expect(parseHash('#/privacy')).toEqual({ name: 'privacy', lang: 'en' });
    expect(parseHash('#/impressum/de')).toEqual({ name: 'impressum', lang: 'de' });
    expect(parseHash('#/sign-in/abc_DEF-1')).toEqual({ name: 'sign-in', token: 'abc_DEF-1' });
    expect(parseHash('#token=abc_DEF-1')).toEqual({ name: 'sign-in', token: 'abc_DEF-1' });
    expect(href({ name: 'privacy', lang: 'de' })).toBe('#/privacy/de');
    expect(href({ name: 'impressum', lang: 'en' })).toBe('#/impressum');
    for (const r of [
      { name: 'settings' },
      { name: 'privacy', lang: 'de' },
      { name: 'practice', source: 'catalogue', id: 'ode-to-joy' },
    ] as const) {
      expect(parseHash(href(r))).toEqual(r);
    }
  });

  it('builds stable absolute catalogue links', () => {
    expect(
      absoluteHref(
        { name: 'practice', source: 'catalogue', id: 'ode-to-joy' },
        'https://opentiles.example/app/#/library',
      ),
    ).toBe('https://opentiles.example/app/#/practice/catalogue/ode-to-joy');
  });
});

describe('misc', () => {
  it('reports audio import progress across stages', () => {
    expect(audioProgressValue('loading', 0)).toBeLessThan(audioProgressValue('decoding', 0));
    expect(audioProgressValue('transcribing', 0.5)).toBeCloseTo(0.55);
    expect(audioProgressValue('transcribing', 2)).toBe(1);
  });

  it('accepts only https (or local http) sync servers', () => {
    expect(normaliseServerUrl('https://sync.example/')).toBe('https://sync.example');
    expect(normaliseServerUrl('http://localhost:8787')).toBe('http://localhost:8787');
    expect(normaliseServerUrl('http://sync.example')).toBeNull();
    expect(normaliseServerUrl('')).toBeNull();
    expect(normaliseServerUrl(undefined)).toBeNull();
    expect(normaliseServerUrl('not a url')).toBeNull();
  });
});

describe('touch (P6-11)', () => {
  it('is natural unless even was chosen', () => {
    expect(normaliseSettings(undefined).touch).toBe('natural');
    expect(normaliseSettings({ touch: 'even' }).touch).toBe('even');
    expect(normaliseSettings({ touch: 'loud' }).touch).toBe('natural');
  });
});
