// Library entry for tests and for embedding the service (the sync client's tests run it
// in-process). The runnable server is src/server.ts.
export { createApp, type AppDeps, type SyncApp } from './app.js';
export { fsBlobStore, memoryBlobStore, type BlobStore } from './blob-store.js';
export { MB, makeConfig, settingsFromEnv, type Config, type ServerSettings } from './config.js';
export { sanitiseCrashReport, scrub, type CrashReport } from './crash.js';
export { openDatabase, type Database } from './db.js';
export {
  consoleMailer,
  httpMailer,
  memoryMailer,
  signInMessage,
  smtpMailer,
  type MailMessage,
  type Mailer,
} from './mailer.js';
export { s3BlobStore, signV4, type S3Options } from './s3.js';
