// The iPad app (apps/ios-shell) runs this same web app in a WKWebView. Capacitor's native bridge
// defines window.Capacitor before any page script runs, so the shell can be detected without
// importing Capacitor into the browser bundle.

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  isPluginAvailable?: (name: string) => boolean;
}

function capacitor(): CapacitorGlobal | undefined {
  const cap: unknown = (globalThis as { Capacitor?: unknown }).Capacitor;
  return typeof cap === 'object' && cap !== null ? (cap as CapacitorGlobal) : undefined;
}

/** True inside the native app, false in every browser (including a Home Screen web app). */
export function isNativeShell(): boolean {
  try {
    return capacitor()?.isNativePlatform?.() === true;
  } catch {
    return false;
  }
}

/** True when the native app ships a plugin with this JavaScript name (for example 'CoreMidi'). */
export function hasNativePlugin(name: string): boolean {
  try {
    return isNativeShell() && capacitor()?.isPluginAvailable?.(name) === true;
  } catch {
    return false;
  }
}
