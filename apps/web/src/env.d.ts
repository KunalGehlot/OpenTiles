/// <reference types="vite/client" />

/** True in development and preview builds: unverified catalogue pieces are listed with a badge. */
declare const __SHOW_UNVERIFIED__: boolean;

interface ImportMetaEnv {
  /** Base URL of the optional sync service (P3-03). Unset: no sync and no crash reports. */
  readonly VITE_SYNC_URL?: string;
}
