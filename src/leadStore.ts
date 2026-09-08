import * as fs from 'fs';
import * as path from 'path';

const DB_DIR = path.resolve(__dirname, '..', 'db');
const LEADS_PATH = path.join(DB_DIR, 'leads.json');

type Lead = {
  id: string;
  telegramId: string;
  name?: string;
  stage?: string;
  createdAt: string;
  updatedAt?: string;
};

function ensureStore(): void {
  fs.mkdirSync(DB_DIR, { recursive: true });
  if (!fs.existsSync(LEADS_PATH)) {
    fs.writeFileSync(LEADS_PATH, '[]', 'utf-8');
  }
}

function readJson(): Lead[] {
  ensureStore();

  try {
    const raw = fs.readFileSync(LEADS_PATH, 'utf-8').trim();
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error(`Failed to parse ${LEADS_PATH}; resetting store.`, error);
    writeJson([]);
    return [];
  }
}

function writeJson(data: Lead[]): void {
  ensureStore();
  fs.writeFileSync(LEADS_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

export async function getLeads(): Promise<Lead[]> {
  return readJson();
}

export async function addLead(lead: { telegramId: string; name?: string; stage?: string }): Promise<Lead> {
  const leads = readJson();
  const existing = leads.find((item) => item.telegramId === lead.telegramId);

  if (existing) {
    const updated: Lead = {
      ...existing,
      ...Object.fromEntries(Object.entries(lead).filter(([, value]) => value !== undefined)),
      updatedAt: new Date().toISOString(),
    };
    const index = leads.findIndex((item) => item.telegramId === lead.telegramId);
    leads[index] = updated;
    writeJson(leads);
    return updated;
  }

  const newLead: Lead = {
    id: Date.now().toString(),
    telegramId: lead.telegramId,
    name: lead.name,
    stage: lead.stage || 'new',
    createdAt: new Date().toISOString(),
  };

  writeJson([...leads, newLead]);
  return newLead;
}

export async function updateLead(id: string, patches: { name?: string; stage?: string }): Promise<Lead | null> {
  const leads = readJson();
  const index = leads.findIndex((item) => item.id === id);

  if (index === -1) return null;

  const updated: Lead = {
    ...leads[index],
    ...Object.fromEntries(Object.entries(patches).filter(([, value]) => value !== undefined)),
    updatedAt: new Date().toISOString(),
  };

  leads[index] = updated;
  writeJson(leads);
  return updated;
}

export async function updateLeadByTelegramId(
  telegramId: string,
  patches: { name?: string; stage?: string }
): Promise<Lead | null> {
  const leads = readJson();
  const index = leads.findIndex((item) => item.telegramId === telegramId);

  if (index === -1) return null;

  const updated: Lead = {
    ...leads[index],
    ...Object.fromEntries(Object.entries(patches).filter(([, value]) => value !== undefined)),
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
