// The iPad shell wraps the unchanged web app (spec §5, PLAN.md P3-01). Its only native addition is
// the CoreMIDI plugin in plugins/core-midi, because no iOS/iPadOS browser has Web MIDI.
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'org.opentiles.app',
  appName: 'OpenTiles',
  // The production build of apps/web. `pnpm ios` builds it before syncing.
  webDir: '../web/dist',
  // Only the plugin this app actually ships; nothing else is picked up from node_modules.
  includePlugins: ['@opentiles/capacitor-core-midi'],
  loggingBehavior: 'debug',
  ios: {
    // --bg (light) in apps/web/src/styles/tokens.css, shown before the page has painted.
    backgroundColor: '#f6f5f1',
    // The WebView fills the screen, status bar included; the web app pads itself with
    // env(safe-area-inset-*) (viewport-fit=cover). 'automatic' would add the insets as scroll
    // padding, which can make the full-height practice screen scroll.
    contentInset: 'never',
    // Long-pressing a piece card should not pop up a link preview: this is an app, not a page.
    allowsLinkPreview: false,
    // The app sends no push or local notifications, so Capacitor need not handle them.
    handleApplicationNotifications: false,
  },
};

export default config;
