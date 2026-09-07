import * as fs from 'fs';
import * as path from 'path';

const LEADS_PATH = path.resolve('./db/leads.json');

function readJson(): any {
  const raw = fs.readFileSync(LEADS_PATH, 'utf-8');
  return raw ? JSON.parse(raw) : [];
}

function writeJson(data: any): void {
  fs.writeFileSync(LEADS_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

export async function getLeads() {
  return readJson();
}

export async function addLead(lead: { telegramId: string; name?: string; stage?: string }) {
  const leads = readJson();
  // avoid duplicate telegramId
  const exists = leads.find(l => l.telegramId === lead.telegramId);
  if (exists) return exists;
  const newLead = { id: Date.now().toString(), ...lead, createdAt: new Date().toISOString() };
  writeJson([...leads, newLead]);
  return newLead;
}

export async function updateLead(id: string, patches: { name?: string; stage?: string }) {
  const leads = readJson();
  const idx = leads.findIndex(l => l.id === id);
  if (idx === -1) return null;
  const updated = { ...leads[idx], ...patches, updatedAt: new Date().toISOString() };
  leads[idx] = updated;
  writeJson(leads);
  return updated;
}

export async function deleteLead(id: string) {
  const leads = readJson();
  const newLeads = leads.filter(l => l.id !== id);
  writeJson(newLeads);
  return leads.length !== newLeads.length;
}