import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { isoCBOR } from '@simplewebauthn/server/helpers';
import { expect } from 'vitest';
import { createApp } from '../src/app.js';
import { memoryBlobStore, type BlobStore } from '../src/blob-store.js';
import { makeConfig, type Config } from '../src/config.js';
import { openDatabase } from '../src/db.js';
import { memoryMailer } from '../src/mailer.js';

export const ORIGIN = 'https://app.opentiles.test';
export const START = Date.UTC(2026, 9, 7, 12, 34, 56);

export function setup(
  overrides: Partial<Omit<Config, 'appOrigins'>> = {},
  blobs: BlobStore & { keys?: () => string[] } = memoryBlobStore(),
) {
  let clock = START;
  const config = makeConfig({ appOrigins: [ORIGIN], ...overrides });
  const db = openDatabase(':memory:');
  const mailer = memoryMailer();
  const logs: string[] = [];
  const sync = createApp({
    config,
    db,
    blobs,
    mailer,
    now: () => clock,
    log: (line) => logs.push(line),
  });

  const request = (path: string, init: RequestInit = {}) => sync.app.request(path, init);

  const json = (
    method: string,
    path: string,
    body: unknown,
    headers: Record<string, string> = {},
  ) =>
    request(path, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });

  /** Signs in by email link and returns the bearer headers. */
  async function signIn(email = 'pianist@example.org') {
    const start = await json('POST', '/v1/auth/email/start', { email });
    expect(start.status).toBe(202);
    const message = mailer.sent.at(-1)!;
    const token = /#token=([A-Za-z0-9_-]+)/.exec(message.text)![1]!;
    const verify = await json('POST', '/v1/auth/email/verify', { token });
    expect(verify.status).toBe(200);
    const session = (await verify.json()) as { token: string; expiresAt: string; created: boolean };
    return { ...session, headers: { authorization: `Bearer ${session.token}` } };
  }

  return {
    config,
    db,
    blobs,
    mailer,
    logs,
    sync,
    request,
    json,
    signIn,
    advance(ms: number) {
      clock += ms;
    },
    now: () => clock,
  };
}

const b64url = (bytes: Uint8Array | Buffer) => Buffer.from(bytes).toString('base64url');
const sha256 = (data: Uint8Array | string) => createHash('sha256').update(data).digest();

/**
 * A software passkey (ES256, "none" attestation), enough to drive real WebAuthn verification in
 * tests without a browser.
 */
export function softwareAuthenticator(origin = ORIGIN, rpId = new URL(ORIGIN).hostname) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const credentialId = randomBytes(16);
  const cose = isoCBOR.encode(
    new Map<number, number | Uint8Array>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, Buffer.from(jwk.x!, 'base64url')],
      [-3, Buffer.from(jwk.y!, 'base64url')],
    ]),
  );
  let counter = 0;
  let userHandle: string | undefined;

  const authData = (flags: number, attested: boolean) => {
    const head = Buffer.alloc(37);
    sha256(rpId).copy(head, 0);
    head[32] = flags;
    head.writeUInt32BE(counter, 33);
    if (!attested) return head;
    const len = Buffer.alloc(2);
    len.writeUInt16BE(credentialId.length);
    return Buffer.concat([head, Buffer.alloc(16), len, credentialId, Buffer.from(cose)]);
  };

  return {
    id: b64url(credentialId),
    register(
      options: { challenge: string; user: { id: string } },
      overrides: { origin?: string } = {},
    ) {
      userHandle = options.user.id;
      const clientData = JSON.stringify({
        type: 'webauthn.create',
        challenge: options.challenge,
        origin: overrides.origin ?? origin,
        crossOrigin: false,
      });
      const attestationObject = isoCBOR.encode(
        new Map<string, string | Uint8Array | Map<string, string>>([
          ['fmt', 'none'],
          ['attStmt', new Map<string, string>()],
          ['authData', authData(0x45, true)],
        ]),
      );
      return {
        id: b64url(credentialId),
        rawId: b64url(credentialId),
        type: 'public-key',
        response: {
          clientDataJSON: b64url(Buffer.from(clientData)),
          attestationObject: b64url(attestationObject),
          transports: ['internal'],
        },
        clientExtensionResults: {},
        authenticatorAttachment: 'platform',
      };
    },
    login(
      options: { challenge: string },
      overrides: { origin?: string; userHandle?: string } = {},
    ) {
      counter += 1;
      const clientData = Buffer.from(
        JSON.stringify({
          type: 'webauthn.get',
          challenge: options.challenge,
          origin: overrides.origin ?? origin,
          crossOrigin: false,
        }),
      );
      const data = authData(0x05, false);
      const signature = sign('sha256', Buffer.concat([data, sha256(clientData)]), privateKey);
      return {
        id: b64url(credentialId),
        rawId: b64url(credentialId),
        type: 'public-key',
        response: {
          clientDataJSON: b64url(clientData),
          authenticatorData: b64url(data),
          signature: b64url(signature),
          userHandle: overrides.userHandle ?? userHandle,
        },
        clientExtensionResults: {},
        authenticatorAttachment: 'platform',
      };
    },
  };
}
