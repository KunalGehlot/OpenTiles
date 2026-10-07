import { describe, expect, it } from 'vitest';
import { hourFloor, sanitiseCrashReport, scrub } from '../src/crash.js';
import { START, setup } from './helpers.js';

const report = {
  app: 'web',
  version: '0.4.1',
  message: 'TypeError: cannot read properties of undefined',
  stack: 'at drawKeyboard (https://app.opentiles.test/assets/index-1a2b.js:1:2345)',
  platform: 'iPadOS 18 / Safari',
  context: { input: 'microphone', mode: 'wait', latencyMs: 42, pedal: true },
};

function post(t: ReturnType<typeof setup>, body: unknown, headers: Record<string, string> = {}) {
  return t.request('/v1/crash', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('POST /v1/crash', () => {
  it('stores a sanitised report with the time rounded to the hour', async () => {
    const t = setup();
    const res = await post(t, { ...report, ip: '203.0.113.9', userId: 'u1', extra: 'dropped' });
    expect(res.status).toBe(202);
    const stored = t.db.listCrashReports();
    expect(stored).toHaveLength(1);
    expect(stored[0]!.receivedAt).toBe(hourFloor(START));
    expect(JSON.parse(stored[0]!.report)).toEqual(report);
  });

  it('never links a report to an account or stores the sender address', async () => {
    const t = setup({ trustProxy: true });
    const s = await t.signIn('crash@example.org');
    await post(t, report, { ...s.headers, 'x-forwarded-for': '198.51.100.23' });
    const row = JSON.stringify(t.db.listCrashReports());
    expect(row).not.toContain('198.51.100.23');
    expect(row).not.toContain('crash@example.org');
    expect(row).not.toContain(s.token);
  });

  it('scrubs email addresses and secrets from free text', async () => {
    const t = setup();
    await post(t, {
      ...report,
      message: 'Failed for anna.schmidt@example.de at /sync/sign-in#token=abc123&x=1',
      stack: 'Authorization: Bearer abcdefghijklmnop',
    });
    const stored = JSON.parse(t.db.listCrashReports()[0]!.report) as typeof report;
    expect(stored.message).toBe('Failed for [email] at /sync/sign-in#token=[removed]&x=1');
    expect(stored.stack).toBe('Authorization: Bearer [removed]');
  });

  it('rejects malformed and oversized reports', async () => {
    const t = setup();
    expect((await post(t, { message: 'no app or version' })).status).toBe(400);
    expect((await post(t, { ...report, app: 'Web App!' })).status).toBe(400);
    expect((await post(t, 'not json')).status).toBe(400);
    expect((await post(t, [report])).status).toBe(400);
    expect((await post(t, { ...report, stack: 'x'.repeat(20_000) })).status).toBe(413);
    expect(t.db.listCrashReports()).toHaveLength(0);
  });

  it('rate-limits per client and globally', async () => {
    const t = setup({
      trustProxy: true,
      crashReports: {
        enabled: true,
        maxBytes: 16 * 1024,
        retentionDays: 30,
        perClientPerHour: 3,
        globalPerHour: 5,
      },
    });
    const from = (ip: string) => ({ 'x-forwarded-for': `10.0.0.1, ${ip}` });
    for (let i = 0; i < 3; i++) expect((await post(t, report, from('192.0.2.1'))).status).toBe(202);
    expect((await post(t, report, from('192.0.2.1'))).status).toBe(429);
    expect((await post(t, report, from('192.0.2.2'))).status).toBe(202);
    expect((await post(t, report, from('192.0.2.3'))).status).toBe(202);
    expect((await post(t, report, from('192.0.2.4'))).status).toBe(429);
    t.advance(60 * 60_000);
    expect((await post(t, report, from('192.0.2.1'))).status).toBe(202);
  });

  it('can be switched off', async () => {
    const t = setup({
      crashReports: {
        enabled: false,
        maxBytes: 16 * 1024,
        retentionDays: 30,
        perClientPerHour: 10,
        globalPerHour: 100,
      },
    });
    expect((await post(t, report)).status).toBe(404);
  });

  it('deletes reports after the retention period', async () => {
    const t = setup();
    await post(t, report);
    t.advance(29 * 24 * 3_600_000);
    await t.sync.runMaintenance();
    expect(t.db.listCrashReports()).toHaveLength(1);
    t.advance(2 * 24 * 3_600_000);
    await t.sync.runMaintenance();
    expect(t.db.listCrashReports()).toHaveLength(0);
  });
});

describe('sanitiseCrashReport', () => {
  it('truncates long fields and limits context', () => {
    const context: Record<string, unknown> = { nested: { a: 1 }, 'bad key!': 'x' };
    for (let i = 0; i < 30; i++) context[`k${i}`] = i;
    const out = sanitiseCrashReport({ ...report, message: 'm'.repeat(5000), context })!;
    expect(out.message).toHaveLength(1000);
    expect(Object.keys(out.context!)).toHaveLength(20);
    expect(out.context).not.toHaveProperty('nested');
    expect(out.context).not.toHaveProperty('bad key!');
  });

  it('strips control characters but keeps line breaks', () => {
    const out = sanitiseCrashReport({ ...report, stack: 'line1\nline2\u0000\u001b[31m' })!;
    expect(out.stack).toBe('line1\nline2[31m');
  });

  it('scrub leaves ordinary text alone', () => {
    expect(scrub('Cannot read property "notes" of undefined')).toBe(
      'Cannot read property "notes" of undefined',
    );
  });
});
