import { createServer, type AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import { getConnInfo } from '@hono/node-server/conninfo';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { memoryBlobStore } from '../src/blob-store.js';
import { makeConfig, settingsFromEnv } from '../src/config.js';
import { openDatabase } from '../src/db.js';
import { httpMailer, memoryMailer, signInMessage, smtpMailer } from '../src/mailer.js';

describe('settingsFromEnv', () => {
  it('fills in sensible defaults for local development', () => {
    const s = settingsFromEnv({ APP_ORIGIN: 'http://localhost:5173' });
    expect(s.port).toBe(8787);
    expect(s.storage).toEqual({ kind: 'fs', root: './data/blobs' });
    expect(s.mailer).toEqual({ kind: 'console' });
    expect(s.config.rpId).toBe('localhost');
    expect(s.config.quotaBytes).toBe(250_000_000);
    expect(s.config.magicLinkUrl).toBe('http://localhost:5173/sync/sign-in#token={token}');
    expect(s.config.crashReports.enabled).toBe(true);
  });

  it('reads S3, SMTP and limits', () => {
    const s = settingsFromEnv({
      NODE_ENV: 'production',
      APP_ORIGIN: 'https://opentiles.example,https://www.opentiles.example',
      RP_ID: 'opentiles.example',
      STORAGE: 's3',
      S3_ENDPOINT: 'https://s3.fr-par.scw.cloud',
      S3_REGION: 'fr-par',
      S3_BUCKET: 'opentiles-sync',
      S3_ACCESS_KEY_ID: 'id',
      S3_SECRET_ACCESS_KEY: 'secret',
      S3_FORCE_PATH_STYLE: 'true',
      MAILER: 'smtp',
      SMTP_URL: 'smtps://user:pass@smtp.example.eu:465',
      MAIL_FROM: 'OpenTiles <no-reply@opentiles.example>',
      QUOTA_BYTES: '100000000',
      TRUST_PROXY: 'yes',
      CRASH_REPORTS: 'off',
    });
    expect(s.config.appOrigins).toEqual([
      'https://opentiles.example',
      'https://www.opentiles.example',
    ]);
    expect(s.config.rpId).toBe('opentiles.example');
    expect(s.storage).toMatchObject({ kind: 's3', region: 'fr-par', forcePathStyle: true });
    expect(s.mailer).toMatchObject({ kind: 'smtp' });
    expect(s.config.quotaBytes).toBe(100_000_000);
    expect(s.config.trustProxy).toBe(true);
    expect(s.config.crashReports.enabled).toBe(false);
  });

  it('refuses unsafe or incomplete production settings', () => {
    expect(() => settingsFromEnv({})).toThrow(/APP_ORIGIN/);
    expect(() => settingsFromEnv({ APP_ORIGIN: 'https://a.example/path' })).toThrow(/bare origin/);
    expect(() =>
      settingsFromEnv({ NODE_ENV: 'production', APP_ORIGIN: 'http://a.example', MAILER: 'smtp' }),
    ).toThrow(/https/);
    expect(() =>
      settingsFromEnv({ NODE_ENV: 'production', APP_ORIGIN: 'https://a.example' }),
    ).toThrow(/console/);
    expect(() => settingsFromEnv({ APP_ORIGIN: 'https://a.example', STORAGE: 's3' })).toThrow(
      /S3_ENDPOINT/,
    );
    expect(() =>
      settingsFromEnv({ APP_ORIGIN: 'https://a.example', MAGIC_LINK_URL: 'https://a.example/x' }),
    ).toThrow(/\{token\}/);
    expect(() => settingsFromEnv({ APP_ORIGIN: 'https://a.example', QUOTA_BYTES: 'lots' })).toThrow(
      /QUOTA_BYTES/,
    );
  });
});

describe('mailers', () => {
  it('writes the sign-in email in plain British English with both link and code', () => {
    const m = signInMessage('a@example.org', 'https://x.example/#token=t', '1234-5678', 15);
    expect(m.subject).toBe('Your OpenTiles sign-in link');
    expect(m.text).toContain('https://x.example/#token=t');
    expect(m.text).toContain('1234-5678');
    expect(m.text).toContain('expire in 15 minutes');
  });

  it('httpMailer posts JSON with a bearer token and reports failures', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    let status = 202;
    const mailer = httpMailer({
      url: 'https://mail.example.eu/send',
      token: 'k3y',
      from: 'no-reply@opentiles.example',
      fetch: (async (url: string, init: RequestInit) => {
        seen.push({ url, init });
        return new Response(null, { status });
      }) as unknown as typeof fetch,
    });
    await mailer.send({ to: 'a@example.org', subject: 's', text: 't' });
    expect(seen[0]!.url).toBe('https://mail.example.eu/send');
    expect(new Headers(seen[0]!.init.headers).get('authorization')).toBe('Bearer k3y');
    expect(JSON.parse(seen[0]!.init.body as string)).toEqual({
      from: 'no-reply@opentiles.example',
      to: 'a@example.org',
      subject: 's',
      text: 't',
    });
    status = 500;
    await expect(mailer.send({ to: 'a@example.org', subject: 's', text: 't' })).rejects.toThrow(
      /HTTP 500/,
    );
  });
});

describe('smtpMailer', () => {
  it('delivers the message to an SMTP server', async () => {
    // A minimal SMTP server: just enough of RFC 5321 for one message.
    const received: string[] = [];
    const smtp = createServer((socket) => {
      socket.setEncoding('utf8');
      let inData = false;
      let buffer = '';
      socket.write('220 test ESMTP\r\n');
      socket.on('data', (chunk: string) => {
        buffer += chunk;
        let index: number;
        while ((index = buffer.indexOf('\r\n')) >= 0) {
          const line = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          if (inData) {
            if (line === '.') {
              inData = false;
              socket.write('250 queued\r\n');
            } else {
              received.push(line);
            }
          } else if (/^(EHLO|HELO)/i.test(line)) {
            socket.write('250 test\r\n');
          } else if (/^DATA/i.test(line)) {
            inData = true;
            socket.write('354 go ahead\r\n');
          } else if (/^QUIT/i.test(line)) {
            socket.end('221 bye\r\n');
          } else {
            socket.write('250 ok\r\n');
          }
        }
      });
    });
    await new Promise<void>((resolve) => smtp.listen(0, '127.0.0.1', () => resolve()));
    const { port } = smtp.address() as AddressInfo;
    try {
      const mailer = smtpMailer({
        url: `smtp://127.0.0.1:${port}`,
        from: 'OpenTiles <no-reply@opentiles.example>',
        unsafeAllowPlaintext: true,
      });
      await mailer.send(
        signInMessage('a@example.org', 'https://x.example/#token=t', '1234-5678', 15),
      );
      const message = received.join('\n');
      expect(message).toContain('Subject: Your OpenTiles sign-in link');
      expect(message).toContain('To: a@example.org');
      expect(message).toContain('1234-5678');
    } finally {
      await new Promise((resolve) => smtp.close(resolve));
    }
  });
});

describe('over real HTTP', () => {
  it('serves the app with @hono/node-server and rate-limits by socket address', async () => {
    const config = makeConfig({ appOrigins: ['http://localhost:5173'] });
    const { app } = createApp({
      config,
      db: openDatabase(':memory:'),
      blobs: memoryBlobStore(),
      mailer: memoryMailer(),
      log: () => undefined,
      clientAddress: (c) => getConnInfo(c).remote.address,
    });
    const server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' });
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    const { port } = server.address() as AddressInfo;
    try {
      const health = await fetch(`http://127.0.0.1:${port}/healthz`);
      expect(await health.text()).toBe('ok');
      const statuses: number[] = [];
      for (let i = 0; i < 12; i++) {
        const res = await fetch(`http://127.0.0.1:${port}/v1/crash`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ app: 'web', version: '1.0.0', message: 'boom' }),
        });
        statuses.push(res.status);
      }
      expect(statuses.filter((s) => s === 202)).toHaveLength(10);
      expect(statuses.at(-1)).toBe(429);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
