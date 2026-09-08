import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { requestMagicToken, verifyMagicToken, emailConfigured } from '../magic';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-os-magic-'));

beforeEach(() => {
  process.env.DATA_DIR = tempRoot;
  delete process.env.MAGIC_DEV_PREVIEW;
  delete process.env.EMAIL_API_KEY;
  delete process.env.EMAIL_FROM;
  fs.rmSync(tempRoot, { recursive: true, force: true });
  fs.mkdirSync(tempRoot, { recursive: true });
});

test('magic: dev preview returns the code; verify consumes it', async () => {
  process.env.MAGIC_DEV_PREVIEW = 'true';
  const d = await requestMagicToken('user@x.io');
  assert.equal(d.delivered, 'preview');
  const code = (d as { code: string }).code;
  assert.match(code, /^\d{6}$/);
  assert.equal(verifyMagicToken('user@x.io', code), true);
  assert.equal(verifyMagicToken('user@x.io', code), false, 'one-time code must be single use');
});

test('magic: wrong or missing codes fail', async () => {
  process.env.MAGIC_DEV_PREVIEW = 'true';
  await requestMagicToken('user2@x.io');
  assert.equal(verifyMagicToken('user2@x.io', '000000'), false);
  assert.equal(verifyMagicToken('nobody@x.io', '123456'), false);
});

test('magic: unconfigured delivery falls back to preview even without MAGIC_DEV_PREVIEW', async () => {
  assert.equal(emailConfigured(), false);
  const d = await requestMagicToken('preview@x.io');
  assert.equal(d.delivered, 'preview');
  assert.match((d as { code: string }).code, /^\d{6}$/);
});

test('magic: configured Resend delivery emails the code and never leaks it back', async () => {
  let sentTo = '';
  let sentBody = '';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url: any, init: any) => {
    const raw = JSON.parse(init.body as string);
    sentTo = raw.to[0];
    sentBody = raw.subject;
    assert.equal(String(url), 'https://api.resend.com/emails');
    assert.equal(init.headers.Authorization, 'Bearer re_test_key');
    assert.equal(init.headers['Content-Type'], 'application/json');
    return new Response(JSON.stringify({ id: 'evt_123' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    process.env.EMAIL_API_KEY = 're_test_key';
    process.env.EMAIL_FROM = 'onboarding@ezvos.dev';
    assert.equal(emailConfigured(), true);
    const d = await requestMagicToken('paying@x.io');
    assert.equal(d.delivered, 'email');
    assert.equal('code' in d, false, 'code must not be exposed when email delivery succeeds');
    assert.equal(sentTo, 'paying@x.io');
    assert.match(sentBody, /sign-in code/i);
    assert.equal(verifyMagicToken('paying@x.io', '000000'), false, 'code remains unguessable');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('magic: broken Resend falls back to preview so login stays possible', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('{"errors":[{"message":"rate limit"}]}', { status: 429, headers: { 'Content-Type': 'application/json' } });
  try {
    process.env.EMAIL_API_KEY = 're_broken';
    process.env.EMAIL_FROM = 'onboarding@ezvos.dev';
    const d = await requestMagicToken('flaky@x.io');
    assert.equal(d.delivered, 'preview', 'fallback keeps sign-in available when delivery fails');
    assert.match((d as { code: string }).code, /^\d{6}$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
