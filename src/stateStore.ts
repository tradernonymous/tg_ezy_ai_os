import * as fs from 'fs';
import * as path from 'path';

// ---------- Atomic, crash-safe state store with .bak recovery ----------

export function dataDir(): string {
  if (process.env.DATA_DIR) return path.resolve(process.env.DATA_DIR);
  return path.resolve(__dirname, '..', 'db');
}

export function statePath(): string {
  return path.join(dataDir(), 'state.json');
}

function parseJson(raw: string): Record<string, any> | null {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function loadState(): Record<string, any> {
  const p = statePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  try {
    const raw = fs.readFileSync(p, 'utf-8').trim();
    if (!raw) return {};
    return parseJson(raw) || {};
  } catch {
    return {};
  }
}

export function loadStateWithRecovery(): { state: Record<string, any>; recovered: boolean } {
  const p = statePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  try {
    const raw = fs.readFileSync(p, 'utf-8').trim();
    if (!raw) return { state: {}, recovered: false };
    const parsed = parseJson(raw);
    if (parsed) return { state: parsed, recovered: false };
    throw new Error('corrupt state.json');
  } catch (e) {
    // Corruption detected — try to recover from the last good backup.
    try {
      const bak = fs.readFileSync(p + '.bak', 'utf-8').trim();
      const recovered = parseJson(bak);
      if (recovered) {
        fs.writeFileSync(p, JSON.stringify(recovered, null, 2), 'utf-8');
        console.warn('[stateStore] Recovered state.json from .bak backup.');
        return { state: recovered, recovered: true };
      }
    } catch {
      // fall through
    }
    console.error('[stateStore] state.json corrupt and no valid backup; starting fresh.', e);
    return { state: {}, recovered: false };
  }
}

export function saveState(state: Record<string, any>): boolean {
  const p = statePath();
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const data = JSON.stringify(state, null, 2);
    if (fs.existsSync(p)) {
      try {
        fs.copyFileSync(p, p + '.bak');
      } catch {
        // backup is best-effort
      }
    }
    const tmp = p + '.tmp';
    fs.writeFileSync(tmp, data, 'utf-8');
    fs.renameSync(tmp, p);
    return true;
  } catch (e) {
    console.error('[stateStore] Failed to save state:', e);
    return false;
  }
}