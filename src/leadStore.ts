import * as fs from 'fs';
import * as path from 'path';
import { dataDir } from './stateStore';

export type LeadStage = 'new' | 'contacted' | 'qualified' | 'closed' | (string & {});

export type Lead = {
  id: string;
  telegramId: string;
  name?: string;
  stage?: LeadStage;
  channel?: string; // telegram | email | whatsapp | tiktok | meta
  email?: string;
  phone?: string;
  tags?: string[];
  value?: number; // deal value in USD
  owner?: string; // sales admin / owner handle
  accountId?: string; // owning dashboard account (per-account data model)
  createdAt: string;
  updatedAt?: string;
};

export type LeadPatch = Partial<Omit<Lead, 'id' | 'telegramId' | 'createdAt'>>;

function leadsPath(): string {
  return path.join(dataDir(), 'leads.json');
}

function ensureStore(): void {
  fs.mkdirSync(dataDir(), { recursive: true });
  if (!fs.existsSync(leadsPath())) {
    fs.writeFileSync(leadsPath(), '[]', 'utf-8');
  }
}

function readJson(): Lead[] {
  ensureStore();
  try {
    const raw = fs.readFileSync(leadsPath(), 'utf-8').trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error(`Failed to parse ${leadsPath()}; resetting store.`, error);
    writeJson([]);
    return [];
  }
}

function writeJson(data: Lead[]): void {
  ensureStore();
  const tmp = leadsPath() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, leadsPath());
}

function sanitize(patches: any): LeadPatch {
  const out: LeadPatch = {};
  if (patches?.name !== undefined) out.name = String(patches.name).slice(0, 120);
  if (patches?.stage !== undefined) {
    const s = String(patches.stage).toLowerCase();
    out.stage = ['new', 'contacted', 'qualified', 'closed'].includes(s) ? (s as LeadStage) : 'new';
  }
  if (patches?.channel !== undefined) out.channel = String(patches.channel).slice(0, 40);
  if (patches?.email !== undefined) out.email = String(patches.email).slice(0, 200);
  if (patches?.phone !== undefined) out.phone = String(patches.phone).slice(0, 60);
  if (patches?.tags !== undefined) out.tags = Array.isArray(patches.tags) ? patches.tags.map((t: any) => String(t).slice(0, 40)) : undefined;
  if (patches?.value !== undefined) {
    const v = Number(patches.value);
    out.value = Number.isFinite(v) && v >= 0 ? v : 0;
  }
  if (patches?.owner !== undefined) out.owner = String(patches.owner).slice(0, 120) || undefined;
  return out;
}

export async function getLeads(): Promise<Lead[]> {
  return readJson();
}

export async function getLeadsForAccount(accountId: string): Promise<Lead[]> {
  return readJson().filter((l) => l.accountId === accountId);
}

// First account (owner) adopts the pre-existing demo data that has no owner.
export async function adoptUnownedLeads(accountId: string): Promise<number> {
  const leads = readJson();
  let adopted = 0;
  for (const l of leads) {
    if (!l.accountId) {
      l.accountId = accountId;
      adopted++;
    }
  }
  if (adopted > 0) writeJson(leads);
  return adopted;
}

export async function addLead(lead: { telegramId: string; name?: string; stage?: string } & Record<string, any>): Promise<Lead> {
  if (!lead?.telegramId) throw new Error('telegramId is required');
  const leads = readJson();
  const patches = sanitize(lead);
  const existing = leads.find((item) => item.telegramId === lead.telegramId);

  if (existing) {
    const updated: Lead = {
      ...existing,
      ...patches,
      updatedAt: new Date().toISOString(),
    };
    const index = leads.findIndex((item) => item.telegramId === lead.telegramId);
    leads[index] = updated;
    writeJson(leads);
    return updated;
  }

  const newLead: Lead = {
    id: `${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    telegramId: String(lead.telegramId),
    name: patches.name,
    stage: patches.stage || 'new',
    channel: patches.channel,
    email: patches.email,
    phone: patches.phone,
    tags: patches.tags,
    value: patches.value,
    owner: patches.owner,
    accountId: lead.accountId ? String(lead.accountId).slice(0, 80) : undefined,
    createdAt: new Date().toISOString(),
  };

  writeJson([...leads, newLead]);
  return newLead;
}

export async function updateLead(id: string, patches: LeadPatch): Promise<Lead | null> {
  const leads = readJson();
  const index = leads.findIndex((item) => item.id === id);
  if (index === -1) return null;
  const updated: Lead = {
    ...leads[index],
    ...sanitize(patches),
    updatedAt: new Date().toISOString(),
  };
  leads[index] = updated;
  writeJson(leads);
  return updated;
}

export async function updateLeadByTelegramId(telegramId: string, patches: LeadPatch): Promise<Lead | null> {
  const leads = readJson();
  const index = leads.findIndex((item) => item.telegramId === telegramId);
  if (index === -1) return null;
  const updated: Lead = {
    ...leads[index],
    ...sanitize(patches),
    updatedAt: new Date().toISOString(),
  };
  leads[index] = updated;
  writeJson(leads);
  return updated;
}

export async function deleteLead(id: string): Promise<boolean> {
  const leads = readJson();
  const newLeads = leads.filter((item) => item.id !== id);
  writeJson(newLeads);
  return leads.length !== newLeads.length;
}

export async function clearLeads(): Promise<void> {
  writeJson([]);
}

export function toCsv(leads: Lead[]): string {
  const header = ['id', 'name', 'stage', 'channel', 'email', 'phone', 'value', 'owner', 'tags', 'createdAt', 'updatedAt', 'telegramId'];
  const esc = (v: any) => {
    const s = v === undefined || v === null ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const rows = leads.map((l) => header.map((h) => esc((l as any)[h])).join(','));
  return [header.map(esc).join(','), ...rows].join('\n');
}