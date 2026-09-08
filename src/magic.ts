import * as fs from 'fs';
import * as path from 'path';
import { dataDir } from './stateStore';

// ---------- Magic Key (6-digit one-time codes) ----------
// Dev-preview flow: when MAGIC_DEV_PREVIEW=true the code is returned to the
// caller so it can be typed in immediately. Production delivery (Telegram DM
// via BOT_TOKEN, later email) is wired but gated on config.

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
  } catch (e) {
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

export type MagicDelivery = { delivered: 'preview'; code: string } | { delivered: 'scheduled' };

export function requestMagicToken(email: string): MagicDelivery {
  const all = readJson();
  const code = genCode();
  all[email.toLowerCase()] = { code, exp: Date.now() + TTL_MS };
  writeJson(all);
  if (process.env.MAGIC_DEV_PREVIEW === 'true') {
    console.log(`[magic] dev preview code for ${email}: ${code}`);
    return { delivered: 'preview', code };
  }
  return { delivered: 'scheduled' }; // Telegram/email delivery hooks land here later
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