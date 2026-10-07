import { describe, expect, it } from 'vitest';
import { ORIGIN, setup, softwareAuthenticator } from './helpers.js';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

describe('email sign-in', () => {
  it('sends a link with the token in the fragment and a typed-code fallback', async () => {
    const t = setup();
    const res = await t.json('POST', '/v1/auth/email/start', { email: ' Pianist@Example.org ' });
    expect(res.status).toBe(202);
    expect(t.mailer.sent).toHaveLength(1);
    const mail = t.mailer.sent[0]!;
    expect(mail.to).toBe('pianist@example.org');
    expect(mail.text).toMatch(new RegExp(`${ORIGIN}/sync/sign-in#token=[A-Za-z0-9_-]{43}`));
    expect(mail.text).toMatch(/code in the app: \d{4}-\d{4}/);
    expect(mail.text).toContain('expire in 15 minutes');
  });

  it('creates the account on first sign-in and reuses it afterwards', async () => {
    const t = setup();
    const first = await t.signIn();
    expect(first.created).toBe(true);
    const second = await t.signIn();
    expect(second.created).toBe(false);
    expect(t.db.counts().users).toBe(1);
    const account = await t.request('/v1/account', { headers: second.headers });
    expect(account.status).toBe(200);
    expect(((await account.json()) as { email: string }).email).toBe('pianist@example.org');
  });

  it('accepts each link once and only before it expires', async () => {
    const t = setup();
    await t.json('POST', '/v1/auth/email/start', { email: 'a@example.org' });
    const token = /#token=([\w-]+)/.exec(t.mailer.sent[0]!.text)![1]!;
    expect((await t.json('POST', '/v1/auth/email/verify', { token })).status).toBe(200);
    expect((await t.json('POST', '/v1/auth/email/verify', { token })).status).toBe(401);

    await t.json('POST', '/v1/auth/email/start', { email: 'a@example.org' });
    const late = /#token=([\w-]+)/.exec(t.mailer.sent[1]!.text)![1]!;
    t.advance(16 * MINUTE);
    const res = await t.json('POST', '/v1/auth/email/verify', { token: late });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: 'invalid-link' });
  });

  it('signs in with the typed code, for home-screen apps that cannot open links', async () => {
    const t = setup();
    await t.json('POST', '/v1/auth/email/start', { email: 'b@example.org' });
    const code = /code in the app: (\d{4}-\d{4})/.exec(t.mailer.sent[0]!.text)![1]!;
    const res = await t.json('POST', '/v1/auth/email/verify', { email: 'B@example.org', code });
    expect(res.status).toBe(200);
  });

  it('burns the codes after five wrong guesses', async () => {
    const t = setup();
    await t.json('POST', '/v1/auth/email/start', { email: 'c@example.org' });
    const code = /code in the app: (\d{4}-\d{4})/.exec(t.mailer.sent[0]!.text)![1]!;
    const wrong = code === '0000-0000' ? '1111-1111' : '0000-0000';
    for (let i = 0; i < 5; i++) {
      const res = await t.json('POST', '/v1/auth/email/verify', {
        email: 'c@example.org',
        code: wrong,
      });
      expect(res.status).toBe(401);
    }
    const res = await t.json('POST', '/v1/auth/email/verify', { email: 'c@example.org', code });
    expect(res.status).toBe(401);
  });

  it('keeps only the newest three links per address', async () => {
    const t = setup();
    for (let i = 0; i < 4; i++) {
      await t.json('POST', '/v1/auth/email/start', { email: 'd@example.org' });
      t.advance(1000);
    }
    const tokens = t.mailer.sent.map((m) => /#token=([\w-]+)/.exec(m.text)![1]!);
    expect((await t.json('POST', '/v1/auth/email/verify', { token: tokens[0] })).status).toBe(401);
    expect((await t.json('POST', '/v1/auth/email/verify', { token: tokens[3] })).status).toBe(200);
    // Signing in invalidates the other open links for that address.
    expect((await t.json('POST', '/v1/auth/email/verify', { token: tokens[2] })).status).toBe(401);
  });

  it('rejects malformed addresses and limits requests per address', async () => {
    const t = setup();
    for (const email of ['', 'no-at-sign', 'a@b', `${'x'.repeat(250)}@example.org`, 42]) {
      expect((await t.json('POST', '/v1/auth/email/start', { email })).status).toBe(400);
    }
    for (let i = 0; i < 5; i++) {
      expect(
        (await t.json('POST', '/v1/auth/email/start', { email: 'e@example.org' })).status,
      ).toBe(202);
    }
    expect((await t.json('POST', '/v1/auth/email/start', { email: 'e@example.org' })).status).toBe(
      429,
    );
    t.advance(61 * MINUTE);
    expect((await t.json('POST', '/v1/auth/email/start', { email: 'e@example.org' })).status).toBe(
      202,
    );
  });

  it('reports a mail failure without creating anything usable', async () => {
    const t = setup();
    t.mailer.send = async () => {
      throw new Error('smtp down');
    };
    const res = await t.json('POST', '/v1/auth/email/start', { email: 'f@example.org' });
    expect(res.status).toBe(503);
  });
});

describe('sessions', () => {
  it('requires a valid bearer token', async () => {
    const t = setup();
    expect((await t.request('/v1/account')).status).toBe(401);
    const bogus = { authorization: `Bearer ${'A'.repeat(43)}` };
    expect((await t.request('/v1/account', { headers: bogus })).status).toBe(401);
    expect((await t.request('/v1/account', { headers: { authorization: 'Basic x' } })).status).toBe(
      401,
    );
  });

  it('signs out', async () => {
    const t = setup();
    const s = await t.signIn();
    expect(
      (await t.request('/v1/auth/sign-out', { method: 'POST', headers: s.headers })).status,
    ).toBe(204);
    expect((await t.request('/v1/account', { headers: s.headers })).status).toBe(401);
  });

  it('expires after 90 days without use and slides while in use', async () => {
    const t = setup();
    const active = await t.signIn('active@example.org');
    const idle = await t.signIn('idle@example.org');
    for (let i = 0; i < 4; i++) {
      t.advance(30 * DAY);
      expect((await t.request('/v1/account', { headers: active.headers })).status).toBe(200);
    }
    expect((await t.request('/v1/account', { headers: idle.headers })).status).toBe(401);
  });
});

describe('passkeys', () => {
  async function register(t: ReturnType<typeof setup>, headers: Record<string, string>) {
    const authenticator = softwareAuthenticator();
    const optionsRes = await t.request('/v1/passkeys/options', { method: 'POST', headers });
    expect(optionsRes.status).toBe(200);
    const { challengeId, options } = (await optionsRes.json()) as {
      challengeId: string;
      options: { challenge: string; user: { id: string }; rp: { id: string } };
    };
    expect(options.rp.id).toBe('app.opentiles.test');
    const res = await t.json(
      'POST',
      '/v1/passkeys',
      { challengeId, response: authenticator.register(options) },
      headers,
    );
    expect(res.status).toBe(201);
    return authenticator;
  }

  async function loginWith(
    t: ReturnType<typeof setup>,
    authenticator: ReturnType<typeof softwareAuthenticator>,
    overrides: { origin?: string; userHandle?: string } = {},
  ) {
    const optionsRes = await t.request('/v1/auth/passkey/options', { method: 'POST' });
    const { challengeId, options } = (await optionsRes.json()) as {
      challengeId: string;
      options: { challenge: string };
    };
    return t.json('POST', '/v1/auth/passkey/verify', {
      challengeId,
      response: authenticator.login(options, overrides),
    });
  }

  it('registers a passkey after email sign-in and signs in with it', async () => {
    const t = setup();
    const s = await t.signIn();
    const authenticator = await register(t, s.headers);
    const res = await loginWith(t, authenticator);
    expect(res.status).toBe(200);
    const session = (await res.json()) as { token: string };
    const account = await t.request('/v1/account', {
      headers: { authorization: `Bearer ${session.token}` },
    });
    const body = (await account.json()) as { email: string; passkeys: { id: string }[] };
    expect(body.email).toBe('pianist@example.org');
    expect(body.passkeys.map((p) => p.id)).toEqual([authenticator.id]);
    // A second sign-in works too (the signature counter moves on).
    expect((await loginWith(t, authenticator)).status).toBe(200);
  });

  it('rejects an unknown passkey, a wrong origin and a mismatched user handle', async () => {
    const t = setup();
    const s = await t.signIn();
    const known = await register(t, s.headers);
    expect((await loginWith(t, softwareAuthenticator())).status).toBe(401);
    expect((await loginWith(t, known, { origin: 'https://evil.example' })).status).toBe(401);
    expect((await loginWith(t, known, { userHandle: 'AAAA' })).status).toBe(401);
  });

  it('uses each challenge once', async () => {
    const t = setup();
    const s = await t.signIn();
    const authenticator = await register(t, s.headers);
    const optionsRes = await t.request('/v1/auth/passkey/options', { method: 'POST' });
    const { challengeId, options } = (await optionsRes.json()) as {
      challengeId: string;
      options: { challenge: string };
    };
    const response = authenticator.login(options);
    expect(
      (await t.json('POST', '/v1/auth/passkey/verify', { challengeId, response })).status,
    ).toBe(200);
    expect(
      (await t.json('POST', '/v1/auth/passkey/verify', { challengeId, response })).status,
    ).toBe(401);
  });

  it('refuses registration with a foreign origin or someone else’s challenge', async () => {
    const t = setup();
    const a = await t.signIn('a@example.org');
    const b = await t.signIn('b@example.org');
    const optionsRes = await t.request('/v1/passkeys/options', {
      method: 'POST',
      headers: a.headers,
    });
    const { challengeId, options } = (await optionsRes.json()) as {
      challengeId: string;
      options: { challenge: string; user: { id: string } };
    };
    const authenticator = softwareAuthenticator();
    const stolen = await t.json(
      'POST',
      '/v1/passkeys',
      { challengeId, response: authenticator.register(options) },
      b.headers,
    );
    expect(stolen.status).toBe(400);

    const again = await t.request('/v1/passkeys/options', { method: 'POST', headers: a.headers });
    const fresh = (await again.json()) as {
      challengeId: string;
      options: { challenge: string; user: { id: string } };
    };
    const foreign = await t.json(
      'POST',
      '/v1/passkeys',
      {
        challengeId: fresh.challengeId,
        response: authenticator.register(fresh.options, { origin: 'https://evil.example' }),
      },
      a.headers,
    );
    expect(foreign.status).toBe(400);
  });

  it('removes a passkey', async () => {
    const t = setup();
    const s = await t.signIn();
    const authenticator = await register(t, s.headers);
    const res = await t.request(`/v1/passkeys/${authenticator.id}`, {
      method: 'DELETE',
      headers: s.headers,
    });
    expect(res.status).toBe(204);
    expect((await loginWith(t, authenticator)).status).toBe(401);
  });
});
