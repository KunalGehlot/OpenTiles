import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const catalogueDir = resolve(import.meta.dirname, '../../catalogue');

interface IndexFile {
  version: number;
  pieces: { slug: string; verified: boolean; score: string }[];
}

/**
 * Serves the public-domain catalogue at /catalogue/ in development and copies it into the build.
 * Production builds include only verified pieces (spec §2) unless VITE_SHOW_UNVERIFIED=1, which
 * preview deployments use so reviewers can try pieces before verifying them.
 */
function catalogue(showUnverified: boolean): Plugin {
  const readIndex = (): IndexFile => {
    const raw = JSON.parse(readFileSync(join(catalogueDir, 'index.json'), 'utf8')) as IndexFile;
    return showUnverified ? raw : { ...raw, pieces: raw.pieces.filter((p) => p.verified) };
  };
  const types: Record<string, string> = {
    '.json': 'application/json',
    '.musicxml': 'application/vnd.recordare.musicxml+xml',
    '.xml': 'application/xml',
    '.mxl': 'application/vnd.recordare.musicxml',
  };
  return {
    name: 'opentiles-catalogue',
    configureServer(server) {
      server.middlewares.use('/catalogue/', (req, res, next) => {
        const path = decodeURIComponent((req.url ?? '').split('?')[0] ?? '');
        if (path === '/index.json' || path === 'index.json') {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(readIndex()));
          return;
        }
        const file = resolve(catalogueDir, `.${path.startsWith('/') ? path : `/${path}`}`);
        if (
          !file.startsWith(join(catalogueDir, 'pieces')) ||
          !existsSync(file) ||
          !statSync(file).isFile()
        ) {
          next();
          return;
        }
        res.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream');
        res.end(readFileSync(file));
      });
    },
    generateBundle() {
      const index = readIndex();
      this.emitFile({
        type: 'asset',
        fileName: 'catalogue/index.json',
        source: JSON.stringify(index),
      });
      for (const p of index.pieces) {
        this.emitFile({
          type: 'asset',
          fileName: `catalogue/${p.score}`,
          source: readFileSync(join(catalogueDir, p.score)),
        });
      }
    },
  };
}

/**
 * Installable, fully offline app (spec §5, §6; PLAN.md P1-23). Everything a practice session needs
 * is precached on the first visit: the app shell, the engine wasm and its AudioWorklet, the
 * catalogue index and scores (emitted into dist/catalogue by the plugin above) and the piano
 * samples under public/samples/piano. The private library lives in IndexedDB, not in the cache.
 * The service worker waits for the user to accept an update ('prompt') so a reload never
 * interrupts a practice run.
 */
function pwa(): Plugin[] {
  return VitePWA({
    registerType: 'prompt',
    // src/pwa/register.ts registers the worker itself and shows the update bar.
    injectRegister: false,
    // The glob below already picks up the icons; listing them twice only bloats the precache.
    includeManifestIcons: false,
    manifest: {
      id: './',
      name: 'OpenTiles',
      short_name: 'OpenTiles',
      description:
        'Free, open-source piano trainer. Practise public-domain pieces or your own files, with instant feedback.',
      lang: 'en',
      start_url: './',
      scope: './',
      display: 'standalone',
      orientation: 'any',
      theme_color: '#1f6f5c',
      background_color: '#fbfaf7',
      categories: ['education', 'music'],
      icons: [
        { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
        { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
        { src: 'maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' },
      ],
    },
    workbox: {
      // One pattern so an empty samples folder does not trigger workbox's "useless glob" warning.
      // .mp3 is for public/samples/piano/*.mp3; source maps stay out of the cache, and the plugin
      // adds manifest.webmanifest itself.
      globPatterns: ['**/*.{html,js,css,wasm,json,musicxml,mxl,xml,svg,png,mp3}'],
      // The main bundle and individual samples are well below this; the default 2 MiB is too
      // close for comfort once the sampler lands.
      maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      // Take control of the first page right after install, so a tab that goes offline without
      // a reload can still open catalogue pieces. Updates still wait for the user ('prompt').
      clientsClaim: true,
      cleanupOutdatedCaches: true,
      navigateFallback: 'index.html',
    },
  });
}

export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [
    react(),
    catalogue(mode === 'development' || process.env.VITE_SHOW_UNVERIFIED === '1'),
    pwa(),
  ],
  define: {
    __SHOW_UNVERIFIED__: JSON.stringify(
      mode === 'development' || process.env.VITE_SHOW_UNVERIFIED === '1',
    ),
  },
  worker: { format: 'es' },
  build: { target: 'es2022', sourcemap: true },
  server: { fs: { allow: [resolve(import.meta.dirname, '../..')] } },
}));
