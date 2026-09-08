import * as crypto from 'crypto';

// ---------- Signed session cookies (HMAC-SHA256, no new deps) ----------

const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

function isProd(): boolean {
  return process.env.NODE_ENV === 'production' || !!process.env.FLY_APP_NAME;
}

// Generated once per process. Used only when SESSION_SECRET is unset: a random
// value means sessions reset on restart, but a hardcoded fallback living in a
// public repo would let anyone forge a session cookie for any account.
const EPHEMERAL_SECRET = crypto.randomBytes(32).toString('hex');

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) {
    console.error(
      '[session] SESSION_SECRET missing — falling back to a random per-boot secret. ' +
        'Everyone is signed out on every restart or redeploy. Set SESSION_SECRET.',
    );
    return EPHEMERAL_SECRET;
  }
  if (s.length < 32) console.warn('[session] SESSION_SECRET is shorter than 32 chars — use a long random string.');
  return s;
}

export function signSession(accountId: string): string {
  const payload = Buffer.from(JSON.stringify({ uid: accountId, exp: Date.now() + SESSION_LIFETIME_MS })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifySession(token: string | undefined | null): string | null {
  if (!token) return null;
  try {
    const [payload, sig] = token.split('.');
    if (!payload || !sig) return null;
    const expected = crypto.createHmac('sha256', secret()).update(payload).digest();
    const got = Buffer.from(sig, 'base64url');
    if (expected.length !== got.length || !crypto.timingSafeEqual(expected, got)) return null;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
    if (!data || typeof data.uid !== 'string' || !data.exp || Number(data.exp) < Date.now()) return null;
    return data.uid;
  } catch {
    // Malformed or tampered cookie: treat as signed out.
    return null;
  }
}

export const SESSION_COOKIE = isProd() ? '__Host-evoss-session' : 'evoss_session';

export function sessionCookieOptions(clear = false): {
  httpOnly: boolean;
  sameSite: 'lax';
  secure: boolean;
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: isProd(),
    path: '/',
    maxAge: clear ? 0 : SESSION_LIFETIME_MS,
  };
}