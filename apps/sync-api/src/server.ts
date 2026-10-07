// Entry point: reads settings from the environment and serves the API on Node 22.
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { serve } from '@hono/node-server';
import { getConnInfo } from '@hono/node-server/conninfo';
import { createApp } from './app.js';
import { fsBlobStore, type BlobStore } from './blob-store.js';
import { settingsFromEnv, type ServerSettings } from './config.js';
import { openDatabase } from './db.js';
import { consoleMailer, httpMailer, smtpMailer, type Mailer } from './mailer.js';
import { s3BlobStore } from './s3.js';

const MAINTENANCE_INTERVAL_MS = 10 * 60 * 1000;

function blobStoreFor(settings: ServerSettings): BlobStore {
  const s = settings.storage;
  if (s.kind === 'fs') return fsBlobStore(s.root);
  return s3BlobStore(s);
}

function mailerFor(settings: ServerSettings): Mailer {
  const m = settings.mailer;
  if (m.kind === 'smtp') return smtpMailer(m);
  if (m.kind === 'http') return httpMailer(m);
  return consoleMailer();
}

export function startServer(settings: ServerSettings) {
  if (settings.databasePath !== ':memory:') {
    mkdirSync(dirname(settings.databasePath), { recursive: true });
  }
  const db = openDatabase(settings.databasePath);
  const { app, runMaintenance } = createApp({
    config: settings.config,
    db,
    blobs: blobStoreFor(settings),
    mailer: mailerFor(settings),
    clientAddress: (c) => {
      try {
        return getConnInfo(c).remote.address;
      } catch {
        return undefined;
      }
    },
  });

  const maintain = () => {
    runMaintenance().catch((error: unknown) => {
      console.error(`maintenance failed (${(error as Error).name})`);
    });
  };
  maintain();
  const timer = setInterval(maintain, MAINTENANCE_INTERVAL_MS);
  timer.unref();

  const server = serve(
    { fetch: app.fetch, port: settings.port, hostname: settings.host },
    (info) => {
      console.log(`OpenTiles sync listening on ${info.address}:${info.port}`);
    },
  );

  const stop = () => {
    clearInterval(timer);
    server.close(() => {
      db.close();
      process.exit(0);
    });
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  return server;
}

startServer(settingsFromEnv(process.env));
