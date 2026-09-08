import * as fs from 'fs';
import * as path from 'path';
import { dataDir } from './stateStore';

// ---------- Magic Key (6-digit one-time codes) ----------
// Delivery order: real email via Resend when EMAIL_API_KEY + EMAIL_FROM are
// set; otherwise the code is returned to the caller as a dev preview so local
// and unconfigured environments stay usable.

const TTL_MS = 10 * 60 * 1000;

interface MagicEntry {
  code: string;
  exp: number;
}

function magicPath(): string {
  return path.join(dataDir(), 'magic.json');
}

function readJson(): Record<string, MagicEntry> {
  fs.mkdirSync(dataDir(), { recursive: true });
  try {
    const raw = fs.readFileSync(magicPath(), 'utf-8').trim();
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeJson(data: Record<string, MagicEntry>): void {
  fs.mkdirSync(dataDir(), { recursive: true });
  const tmp = magicPath() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, magicPath());
}

function genCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export type MagicDelivery =
  | { delivered: 'preview'; code: string }
  | { delivered: 'email' }
  | { delivered: 'scheduled' };

export function emailConfigured(): boolean {
  return Boolean(process.env.EMAIL_API_KEY && process.env.EMAIL_FROM);
}

async function sendMagicEmail(email: string, code: string): Promise<boolean> {
  const key = process.env.EMAIL_API_KEY!;
  const from = process.env.EMAIL_FROM!;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [email],
        subject: 'Your EzyViral OS sign-in code',
        text: `Your one-time sign-in code is ${code}. It expires in 10 minutes. If you didn't request this, you can ignore this email.`,
      }),
    });
    if (!res.ok) {
      console.error(`[magic] email send failed: ${res.status} ${await res.text().catch(() => '')}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[magic] email send error', e);
    return false;
  }
}

export async function requestMagicToken(email: string): Promise<MagicDelivery> {
  const all = readJson();
  const code = genCode();
  all[email.toLowerCase()] = { code, exp: Date.now() + TTL_MS };
  writeJson(all);
  if (process.env.MAGIC_DEV_PREVIEW === 'true' || !emailConfigured()) {
    console.log(`[magic] dev preview code for ${email}: ${code}`);
    return { delivered: 'preview', code };
  }
  const sent = await sendMagicEmail(email, code);
  console.log(sent ? `[magic] code emailed to ${email}` : `[magic] email send failed for ${email}; falling back to preview`);
  return sent ? { delivered: 'email' } : { delivered: 'preview', code };
}

export function verifyMagicToken(email: string, code: string): boolean {
  const entry = readJson()[email.toLowerCase()];
  if (!entry) return false;
  if (entry.exp < Date.now()) {
    const all = readJson();
    delete all[email.toLowerCase()];
    writeJson(all);
    return false;
  }
  const ok = entry.code === String(code || '').trim();
  if (ok) {
    const all = readJson();
    delete all[email.toLowerCase()];
    writeJson(all);
  }
  return ok;
}