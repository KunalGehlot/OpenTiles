import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
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
 * The image decoders pdf.js needs for scanned sheet music (JBIG2 and JPEG 2000 pages; ADR 0018),
 * served from the app itself at pdfjs/wasm/ with their licences, and precached like the rest.
 * pdf.js asks for them by name from the folder it is given (views/sheet/pdf.ts).
 */
function pdfjsWasm(): Plugin {
  const dir = resolve(import.meta.dirname, 'node_modules/pdfjs-dist/wasm');
  const decoders = ['jbig2.wasm', 'openjpeg.wasm'];
  const licences = [
    'LICENSE_JBIG2',
    'LICENSE_OPENJPEG',
    'LICENSE_PDFJS_JBIG2',
    'LICENSE_PDFJS_OPENJPEG',
  ];
  return {
    name: 'opentiles-pdfjs-wasm',
    configureServer(server) {
      server.middlewares.use('/pdfjs/wasm/', (req, res, next) => {
        const name = (req.url ?? '').replace(/^\//, '').split('?')[0] ?? '';
        if (!decoders.includes(name) && !licences.includes(name)) {
          next();
          return;
        }
        res.setHeader('Content-Type', name.endsWith('.wasm') ? 'application/wasm' : 'text/plain');
        res.end(readFileSync(join(dir, name)));
      });
    },
    generateBundle() {
      for (const name of [...decoders, ...licences]) {
        this.emitFile({
          type: 'asset',
          fileName: `pdfjs/wasm/${name}`,
          source: readFileSync(join(dir, name)),
        });
      }
    },
  };
}

/**
 * The Content-Security-Policy of the production build, as a <meta> tag so any static host serves
 * it, GitHub Pages included, which sends no headers of ours (ADR 0016); public/_headers carries the
 * same policy plus the headers a tag cannot set, for hosts that read it. The app loads only its own
 * files: no third-party scripts, fonts or images (hard rule 5). connect-src is the app's own origin, plus the sync server's when the build has one
 * (VITE_SYNC_URL, docs/sync.md), so nothing else can be reached even by injected code.
 * 'wasm-unsafe-eval' lets the engine and the score engraver compile WebAssembly, the engraver's
 * notation font is embedded as a data: URL, and inline styles are style="" attributes set by React
 * and the canvas views.
 * Not applied in development, where Vite injects inline scripts.
 */
export function contentSecurityPolicy(syncUrl?: string): string {
  let sync = '';
  try {
    if (syncUrl?.trim()) sync = ` ${new URL(syncUrl.trim()).origin}`;
  } catch {
    // Not a URL: the app has no sync then either (src/sync/config.ts).
  }
  return [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "font-src 'self' data:",
    `connect-src 'self'${sync}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

function securityMeta(policy: string): Plugin {
  return {
    name: 'opentiles-csp',
    apply: 'build',
    transformIndexHtml: () => [
      {
        tag: 'meta',
        attrs: { 'http-equiv': 'Content-Security-Policy', content: policy },
        injectTo: 'head-prepend',
      },
      { tag: 'meta', attrs: { name: 'referrer', content: 'no-referrer' }, injectTo: 'head' },
    ],
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
      background_color: '#f6f5f1',
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
      // The main bundle and individual samples are well below this. The largest file is the
      // Verovio score engraver (~8 MB: WebAssembly embedded in one lazy-loaded chunk, P1-15); it is
      // precached so the score views work offline even if they were never opened online. pdf.js
      // and its worker (the learner's own sheet music, ADR 0018) are lazy chunks precached the same
      // way, as are its two image decoders for scans.
      maximumFileSizeToCacheInBytes: 16 * 1024 * 1024,
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
    securityMeta(contentSecurityPolicy(loadEnv(mode, import.meta.dirname, 'VITE_').VITE_SYNC_URL)),
    catalogue(mode === 'development' || process.env.VITE_SHOW_UNVERIFIED === '1'),
    pdfjsWasm(),
    pwa(),
  ],
  define: {
    __SHOW_UNVERIFIED__: JSON.stringify(
      mode === 'development' || process.env.VITE_SHOW_UNVERIFIED === '1',
    ),
  },
  resolve: {
    alias: { 'node:module': resolve(import.meta.dirname, 'src/lib/node-module-stub.ts') },
  },
  worker: { format: 'es' },
  // The Verovio chunk is large by design and only loaded when a score view opens.
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 9000 },
  server: { fs: { allow: [resolve(import.meta.dirname, '../..')] } },
}));
