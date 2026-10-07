// The settings store: one in-memory copy of the app settings, saved in the IndexedDB settings
// table and applied to <html> as data attributes the stylesheet reads. Components subscribe with
// `useAppSettings`; code outside React (canvas renderers, crash reporting) reads `appSettings()`.
import { useSyncExternalStore } from 'react';
import { getSetting, setSetting } from '../storage/db';
import {
  DEFAULT_APP_SETTINGS,
  canvasLabelScale,
  effectiveAccessibility,
  normaliseSettings,
} from './model';
import type { AppSettings, EffectiveAccessibility, MediaPreferences } from './model';

/** The IndexedDB settings key that holds `AppSettings`. */
export const APP_SETTINGS_KEY = 'app';

let current: AppSettings = normaliseSettings(DEFAULT_APP_SETTINGS);
let effective: EffectiveAccessibility = effectiveAccessibility(current, mediaPreferences());
const listeners = new Set<() => void>();
let loaded: Promise<AppSettings> | null = null;

function mediaPreferences(): MediaPreferences {
  const match = (q: string) =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(q).matches
      : false;
  return {
    prefersMoreContrast: match('(prefers-contrast: more)'),
    prefersReducedMotion: match('(prefers-reduced-motion: reduce)'),
  };
}

function apply(): void {
  effective = effectiveAccessibility(current, mediaPreferences());
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    root.toggleAttribute('data-large-print', effective.largePrint);
    root.toggleAttribute('data-high-contrast', effective.highContrast);
    root.toggleAttribute('data-reduced-motion', effective.reducedMotion);
    root.toggleAttribute('data-left-handed', effective.leftHanded);
  }
  for (const l of listeners) l();
}

/** Loads the saved settings once and applies them. Safe to call many times. */
export function loadAppSettings(): Promise<AppSettings> {
  loaded ??= getSetting<unknown>(APP_SETTINGS_KEY, null)
    .then((stored) => {
      current = normaliseSettings(stored);
      apply();
      return current;
    })
    .catch(() => {
      // Storage can be unavailable (private browsing); defaults still work.
      apply();
      return current;
    });
  return loaded;
}

/** Re-reads the stored settings, for example after a backup was restored. */
export function reloadAppSettings(): Promise<AppSettings> {
  loaded = null;
  return loadAppSettings();
}

export function appSettings(): AppSettings {
  return current;
}

export function effectiveSettings(): EffectiveAccessibility {
  return effective;
}

/** Scale for labels drawn on canvases; read once per frame by renderers. */
export function labelScale(): number {
  return canvasLabelScale(effective);
}

export async function updateAppSettings(patch: Partial<AppSettings>): Promise<void> {
  current = normaliseSettings({ ...current, ...patch });
  apply();
  await setSetting(APP_SETTINGS_KEY, current);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAppSettings(): AppSettings {
  return useSyncExternalStore(subscribe, appSettings, appSettings);
}

export function useEffectiveAccessibility(): EffectiveAccessibility {
  return useSyncExternalStore(subscribe, effectiveSettings, effectiveSettings);
}

/** True when practice controls should sit on the left (P2-15). For the practice view to read. */
export function useLeftHanded(): boolean {
  return useEffectiveAccessibility().leftHanded;
}

/** Starts the store: loads settings and follows OS preference changes. Call once at start-up. */
export function initAppSettings(): Promise<AppSettings> {
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    for (const q of ['(prefers-contrast: more)', '(prefers-reduced-motion: reduce)']) {
      window.matchMedia(q).addEventListener?.('change', apply);
    }
  }
  return loadAppSettings();
}
