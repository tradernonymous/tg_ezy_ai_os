import * as fs from 'fs';
import * as path from 'path';
import { dataDir } from './stateStore';

// ---------- Unified multi-platform inbox (simulated adapters) ----------

export const CHANNELS = ['email', 'whatsapp', 'telegram', 'tiktok', 'meta'] as const;
export type Channel = (typeof CHANNELS)[number];

export interface ConvMessage {
  id: string;
  from: 'customer' | 'agent' | 'system';
  text: string;
  at: string;
}

export interface Conversation {
  id: string;
  channel: Channel;
  customer: { name: string; handle: string; leadId?: string };
  subject?: string;
  unread: number;
  lastAt: string;
  tags?: string[];
  accountId?: string;
  messages: ConvMessage[];
}


function convsPath(): string {
  return path.join(dataDir(), 'conversations.json');
}

function readJson(): Conversation[] {
  fs.mkdirSync(dataDir(), { recursive: true });
  try {
    const raw = fs.readFileSync(convsPath(), 'utf-8').trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error('[inbox] conversations.json corrupt; resetting.', e);
    return [];
  }
}

function writeJson(data: Conversation[]): void {
  fs.mkdirSync(dataDir(), { recursive: true });
  const tmp = convsPath() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, convsPath());
}

function nowIso(): string {
  return new Date().toISOString();
}

function minsAgo(mins: number): string {
  return new Date(Date.now() - mins * 60000).toISOString();
}

// ---------- Deterministic demo simulator (INBOX_SIM !== 'false') ----------

const NAMES = [
  { name: 'Sofia Reyes', handle: 'sofia.reyes', leadId: '1788825216117' },
  { name: 'Daniel Kim', handle: '@d_kim', leadId: undefined },
  { name: 'Priya Sharma', handle: 'priya.buys', leadId: undefined },
  { name: 'Marcus Webb', handle: '+1 (415) 555-0129', leadId: undefined },
  { name: 'Emma Laurent', handle: 'emma@studio.io', leadId: undefined },
  { name: 'Carlos Mendes', handle: '@carlosm', leadId: undefined },
  { name: 'Aisha Omar', handle: 'aisha.biz', leadId: undefined },
  { name: 'Tom Beckett', handle: 'tom@beckett.co', leadId: undefined },
];

function seedTexts(channel: Channel): string[] {
  const byChannel: Record<Channel, string[]> = {
    email: [
      'Hi, we saw your proposal and are interested. Could you share a breakdown of deliverables?',
      'Sent the signed intake form last week — any updates on the campaign kickoff?',
      'Quick question about your pricing for a 3-month retainer.',
    ],
    whatsapp: [
      'Hey! Is this still available for this week?',
      'Can you send me the portfolio link again, please?',
      'We need a landing page done by Friday. Are you free?',
    ],
    telegram: [
      'Nice results on the last campaign! What would a similar launch cost?',
      'Thanks for the PDF. Let me review and get back to you.',
      'Can we book a call this Thursday at 3 PM?',
    ],
    tiktok: [
      'Love the hooks you post! Do you make short-form ads too?',
      'Just followed. How do we start a paid collab?',
      'That last video went viral — we want something like it for our brand.',
    ],
    meta: [
      'Hi, message from your Facebook ad. We want the free PDF.',
      'Interested in the coaching package. What is included?',
      'Saw your story — do you ship internationally?',
    ],
  };
  return byChannel[channel];
}

function channelFor(i: number): Channel {
  return CHANNELS[i % CHANNELS.length];
}

export function seedIfEmpty(): void {
  if (process.env.INBOX_SIM === 'false') return;
  const existing = readJson();
  if (existing.length > 0) return;
  const convs: Conversation[] = [];
  for (let i = 0; i < 8; i++) {
    const channel = channelFor(i);
    const person = NAMES[i % NAMES.length];
    const texts = seedTexts(channel);
    const first = texts[i % texts.length];
    const second = i % 3 === 0 ? 'Also, is there any discount for annual plans?' : undefined;
    const messages: ConvMessage[] = [
      { id: `${i}-1`, from: 'customer', text: first, at: minsAgo(60 - i * 3) },
    ];
    if (second && i % 2 === 0) {
      messages.push({ id: `${i}-0`, from: 'agent', text: 'Absolutely — I can share a custom quote. Give me 30 minutes.', at: minsAgo(55 - i * 3) });
      messages.push({ id: `${i}-2`, from: 'customer', text: second, at: minsAgo(12 + i) });
    } else {
      messages.push({ id: `${i}-0`, from: 'agent', text: 'Great question! I will get back to you shortly with details.', at: minsAgo(55 - i * 3) });
    }
    convs.push({
      id: `conv-${i + 1}`,
      channel,
      customer: { name: person.name, handle: person.handle, leadId: person.leadId },
      subject: channel === 'email' ? 'New inquiry about your services' : undefined,
      unread: i % 3 === 0 ? 1 : 0,
      lastAt: messages[messages.length - 1].at,
      tags: i % 4 === 0 ? ['hot'] : undefined,
      messages,
    });
  }
  writeJson(convs);
}

// ---------- API ----------

export function getConversations(accountId?: string, channel?: Channel): Conversation[] {
  seedIfEmpty();
  const all = readJson();
  const scoped = accountId ? all.filter((c) => !c.accountId || c.accountId === accountId) : all;
  const filtered = channel ? scoped.filter((c) => c.channel === channel) : scoped;
  return filtered.sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1));
}

export function unreadTotals(accountId?: string): { total: number; byChannel: Partial<Record<Channel, number>> } {
  seedIfEmpty();
  const all = readJson();
  const scoped = accountId ? all.filter((c) => !c.accountId || c.accountId === accountId) : all;
  const byChannel: Partial<Record<Channel, number>> = {};
  let total = 0;
  for (const c of scoped) {
    const n = c.unread || 0;
    byChannel[c.channel] = (byChannel[c.channel] || 0) + n;
    total += n;
  }
  return { total, byChannel };
}

// First account (owner) adopts seeded conversations without an owner.
export function adoptUnownedConvs(accountId: string): number {
  const convs = readJson();
  let adopted = 0;
  for (const c of convs) {
    if (!c.accountId) {
      c.accountId = accountId;
      adopted++;
    }
  }
  if (adopted > 0) writeJson(convs);
  return adopted;
}

export function getConversation(id: string): Conversation | undefined {
  return readJson().find((c) => c.id === id);
}

export function markRead(id: string): Conversation | undefined {
  const convs = readJson();
  const c = convs.find((x) => x.id === id);
  if (!c) return undefined;
  if (c.unread) {
    c.unread = 0;
    writeJson(convs);
  }
  return c;
}

export function reply(id: string, text: string): Conversation | undefined {
  if (!text || !text.trim()) return undefined;
  const convs = readJson();
  const c = convs.find((x) => x.id === id);
  if (!c) return undefined;
  c.messages.push({ id: `${Date.now()}-r`, from: 'agent', text: text.trim(), at: nowIso() });
  c.lastAt = nowIso();
  writeJson(convs);
  scheduleSimulatedFollowUp(id);
  return c;
}

function scheduleSimulatedFollowUp(id: string): void {
  const delayMs = 20000 + Math.floor(Math.random() * 25000); // 20–45s
  const t = setTimeout(() => {
    const convs = readJson();
    const c = convs.find((x) => x.id === id);
    if (!c) return;
    const replies = ['Got it, thank you!', 'Perfect, that works for me.', 'Can you also send an invoice?', 'Awesome — let me share this with the team.'];
    c.messages.push({ id: `${Date.now()}-f`, from: 'customer', text: replies[id.length % replies.length], at: nowIso() });
    c.unread = (c.unread || 0) + 1;
    c.lastAt = nowIso();
    writeJson(convs);
  }, delayMs);
  t.unref();
}