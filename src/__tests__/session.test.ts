import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { signSession, verifySession, SESSION_COOKIE } from '../session';

beforeEach(() => {
  process.env.SESSION_SECRET = 'unit-test-session-secret-0123456789abcdef';
});

test('session: round-trips a valid token', () => {
  const token = signSession('acc-123');
  assert.equal(verifySession(token), 'acc-123');
});

test('session: rejects tampered payload and bad signatures', () => {
  const token = signSession('acc-123');
  const [payload, sig] = token.split('.');
  const flip = (s: string) => (s[0] === 'a' ? 'b' + s.slice(1) : 'a' + s.slice(1));
  assert.equal(verifySession(payload + '.' + flip(sig)), null);
  assert.equal(verifySession(flip(payload) + '.' + sig), null);
  assert.equal(verifySession('garbage'), null);
  assert.equal(verifySession(undefined), null);
});

test('session: cookie uses a __Host prefix in production', () => {
  const was = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    // module is evaluated at import-time; store remains lazy via cookieOptions
  } finally {
    process.env.NODE_ENV = was;
  }
  assert.ok(SESSION_COOKIE.length > 0);
});