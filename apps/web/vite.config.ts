import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';

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

export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [react(), catalogue(mode === 'development' || process.env.VITE_SHOW_UNVERIFIED === '1')],
  define: {
    __SHOW_UNVERIFIED__: JSON.stringify(
      mode === 'development' || process.env.VITE_SHOW_UNVERIFIED === '1',
    ),
  },
  worker: { format: 'es' },
  build: { target: 'es2022', sourcemap: true },
  server: { fs: { allow: [resolve(import.meta.dirname, '../..')] } },
}));
