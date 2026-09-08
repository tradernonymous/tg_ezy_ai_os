import * as fs from 'fs';
import * as path from 'path';
import { dataDir } from './stateStore';
import { mapLegacy, PlanTier, isTier, TIERS } from './plans';

// ---------- Account store (per-user dashboards) ----------

export type AuthProvider = 'google' | 'telegram' | 'magic';

export interface Account {
  id: string;
  provider: AuthProvider;
  providerKey: string; // google sub | telegram chatId | magic email
  name?: string;
  email?: string;
  avatar?: string;
  plan: PlanTier;
  planUntil?: string;
  createdAt: string;
  updatedAt: string;
}

function accountsPath(): string {
  return path.join(dataDir(), 'accounts.json');
}

function ensureStore(): void {
  fs.mkdirSync(dataDir(), { recursive: true });
  if (!fs.existsSync(accountsPath())) {
    fs.writeFileSync(accountsPath(), '[]', 'utf-8');
  }
}

function readJson(): Account[] {
  ensureStore();
  try {
    const raw = fs.readFileSync(accountsPath(), 'utf-8').trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error(`Failed to parse ${accountsPath()}; resetting store.`, error);
    writeJson([]);
    return [];
  }
}

function writeJson(data: Account[]): void {
  ensureStore();
  const tmp = accountsPath() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, accountsPath());
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizePlan(p: string | undefined | null): PlanTier {
  if (isTier(p)) return p as PlanTier;
  return mapLegacy(p);
}

export function getAccount(id: string): Account | undefined {
  return readJson().find((a) => a.id === id);
}

export function getAccountByProviderKey(provider: AuthProvider, providerKey: string): Account | undefined {
  return readJson().find((a) => a.provider === provider && a.providerKey === providerKey);
}

export function countAccounts(): number {
  return readJson().length;
}

export async function createAccount(input: {
  provider: AuthProvider;
  providerKey: string;
  name?: string;
  email?: string;
  avatar?: string;
  legacyPlan?: string;
}): Promise<Account> {
  const accounts = readJson();
  const existing = accounts.find((a) => a.provider === input.provider && a.providerKey === input.providerKey);
  if (existing) return existing;

  const isFirst = accounts.length === 0;
  const plan: PlanTier = isFirst ? 'thinker' : normalizePlan(input.legacyPlan || 'free');

  const account: Account = {
    id: `acc-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
    provider: input.provider,
    providerKey: input.providerKey,
    name: input.name ? String(input.name).slice(0, 120) : undefined,
    email: input.email ? String(input.email).slice(0, 200) : undefined,
    avatar: input.avatar ? String(input.avatar).slice(0, 500) : undefined,
    plan,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  writeJson([...accounts, account]);
  return account;
}

export function updateAccount(id: string, patch: Partial<Pick<Account, 'name' | 'email' | 'avatar' | 'plan' | 'planUntil'>>): Account | null {
  const accounts = readJson();
  const index = accounts.findIndex((a) => a.id === id);
  if (index === -1) return null;
  const current = accounts[index];
  const next: Account = {
    ...current,
    ...(patch.name !== undefined ? { name: String(patch.name).slice(0, 120) } : {}),
    ...(patch.email !== undefined ? { email: String(patch.email).slice(0, 200) || undefined } : {}),
    ...(patch.avatar !== undefined ? { avatar: String(patch.avatar).slice(0, 500) || undefined } : {}),
    ...(patch.plan !== undefined ? { plan: normalizePlan(patch.plan) } : {}),
    ...(patch.planUntil !== undefined ? { planUntil: patch.planUntil } : {}),
    updatedAt: nowIso(),
  };
  accounts[index] = next;
  writeJson(accounts);
  return next;
}

export function listTierNames(): string[] {
  return TIERS.map((t) => t);
}