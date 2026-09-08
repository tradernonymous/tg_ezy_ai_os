import * as fs from 'fs';
import * as path from 'path';
import { dataDir } from './stateStore';

export type ContentKind = 'copy' | 'research' | 'visual';
export type ContentStatus = 'draft' | 'approved' | 'published';

export const CONTENT_KINDS: ContentKind[] = ['copy', 'research', 'visual'];
export const CONTENT_STATUSES: ContentStatus[] = ['draft', 'approved', 'published'];

// Who did what, when. "approved" is a recorded event with an actor and a
// timestamp, not just a flag on the row — the queue and the audit trail both
// read from this.
export type ContentActivity = {
  at: string;
  action: 'created' | 'updated' | 'approved' | 'published' | 'reverted' | 'starred' | 'unstarred';
  actor?: string;
  note?: string;
};

export type ContentItem = {
  id: string;
  accountId?: string;
  kind: ContentKind;
  title: string;
  body: string;
  platform?: string;
  status: ContentStatus;
  // `starred` (saved for reuse — story bank / trend watch) is deliberately
  // separate from `status: 'approved'` (cleared for the publish queue).
  starred: boolean;
  tags?: string[];
  scheduledFor?: string;
  createdAt: string;
  updatedAt?: string;
  activity: ContentActivity[];
};

export type ContentPatch = Partial<
  Pick<ContentItem, 'title' | 'body' | 'platform' | 'tags' | 'scheduledFor' | 'kind'>
>;

export type ContentFilter = {
  kind?: ContentKind;
  status?: ContentStatus;
  starred?: boolean;
  platform?: string;
  from?: string;
  to?: string;
};

function contentPath(): string {
  return path.join(dataDir(), 'content.json');
}

function ensureStore(): void {
  fs.mkdirSync(dataDir(), { recursive: true });
  if (!fs.existsSync(contentPath())) {
    fs.writeFileSync(contentPath(), '[]', 'utf-8');
  }
}

function readJson(): ContentItem[] {
  ensureStore();
  try {
    const raw = fs.readFileSync(contentPath(), 'utf-8').trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error(`Failed to parse ${contentPath()}; resetting store.`, error);
    writeJson([]);
    return [];
  }
}

function writeJson(data: ContentItem[]): void {
  ensureStore();
  const tmp = contentPath() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, contentPath());
}

function newId(): string {
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function isoOrUndefined(value: any): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function sanitizeKind(value: any): ContentKind {
  const k = String(value ?? '').toLowerCase();
  return (CONTENT_KINDS as string[]).includes(k) ? (k as ContentKind) : 'copy';
}

function sanitizeTags(value: any): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map((t: any) => String(t).slice(0, 40)).filter(Boolean).slice(0, 20);
}

function sanitize(patches: any): ContentPatch {
  const out: ContentPatch = {};
  if (patches?.title !== undefined) out.title = String(patches.title).slice(0, 200);
  if (patches?.body !== undefined) out.body = String(patches.body).slice(0, 20000);
  if (patches?.platform !== undefined) out.platform = String(patches.platform).slice(0, 40) || undefined;
  if (patches?.kind !== undefined) out.kind = sanitizeKind(patches.kind);
  if (patches?.tags !== undefined) out.tags = sanitizeTags(patches.tags);
  if (patches?.scheduledFor !== undefined) out.scheduledFor = isoOrUndefined(patches.scheduledFor);
  return out;
}

function log(item: ContentItem, action: ContentActivity['action'], actor?: string, note?: string): void {
  item.activity = item.activity ?? [];
  item.activity.push({ at: new Date().toISOString(), action, actor, note });
  // Keep the trail bounded; the store is a plain JSON file.
  if (item.activity.length > 50) item.activity = item.activity.slice(-50);
}

export async function listContent(): Promise<ContentItem[]> {
  return readJson();
}

export async function listContentForAccount(
  accountId: string,
  filter: ContentFilter = {},
): Promise<ContentItem[]> {
  const from = isoOrUndefined(filter.from);
  const to = isoOrUndefined(filter.to);

  return readJson()
    .filter((c) => c.accountId === accountId)
    .filter((c) => (filter.kind ? c.kind === filter.kind : true))
    .filter((c) => (filter.status ? c.status === filter.status : true))
    .filter((c) => (filter.starred === undefined ? true : Boolean(c.starred) === filter.starred))
    .filter((c) => (filter.platform ? c.platform === filter.platform : true))
    .filter((c) => {
      if (!from && !to) return true;
      const when = c.scheduledFor ?? c.createdAt;
      if (from && when < from) return false;
      if (to && when > to) return false;
      return true;
    })
    .sort((a, b) => (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt));
}

export async function getContent(id: string): Promise<ContentItem | undefined> {
  return readJson().find((c) => c.id === id);
}

export async function addContent(input: {
  accountId?: string;
  kind?: any;
  title?: any;
  body?: any;
  platform?: any;
  tags?: any;
  scheduledFor?: any;
}): Promise<ContentItem> {
  const now = new Date().toISOString();
  const item: ContentItem = {
    id: newId(),
    accountId: input.accountId,
    kind: sanitizeKind(input.kind),
    title: String(input.title ?? '').slice(0, 200) || 'Untitled',
    body: String(input.body ?? '').slice(0, 20000),
    platform: input.platform ? String(input.platform).slice(0, 40) : undefined,
    status: 'draft',
    starred: false,
    tags: sanitizeTags(input.tags),
    scheduledFor: isoOrUndefined(input.scheduledFor),
    createdAt: now,
    updatedAt: now,
    activity: [],
  };
  log(item, 'created', input.accountId);

  const all = readJson();
  all.push(item);
  writeJson(all);
  return item;
}

export async function updateContent(id: string, patches: any, actor?: string): Promise<ContentItem | null> {
  const all = readJson();
  const item = all.find((c) => c.id === id);
  if (!item) return null;

  Object.assign(item, sanitize(patches));
  item.updatedAt = new Date().toISOString();
  log(item, 'updated', actor);
  writeJson(all);
  return item;
}

export async function setContentStatus(
  id: string,
  status: ContentStatus,
  actor?: string,
): Promise<ContentItem | null> {
  if (!CONTENT_STATUSES.includes(status)) return null;

  const all = readJson();
  const item = all.find((c) => c.id === id);
  if (!item) return null;

  const previous = item.status;
  item.status = status;
  item.updatedAt = new Date().toISOString();

  // Moving backwards is a distinct event from moving forwards.
  const rank = (s: ContentStatus) => CONTENT_STATUSES.indexOf(s);
  if (rank(status) < rank(previous)) log(item, 'reverted', actor, `${previous} -> ${status}`);
  else if (status === 'approved') log(item, 'approved', actor);
  else if (status === 'published') log(item, 'published', actor);

  writeJson(all);
  return item;
}

export async function setContentStarred(
  id: string,
  starred: boolean,
  actor?: string,
): Promise<ContentItem | null> {
  const all = readJson();
  const item = all.find((c) => c.id === id);
  if (!item) return null;

  item.starred = Boolean(starred);
  item.updatedAt = new Date().toISOString();
  log(item, item.starred ? 'starred' : 'unstarred', actor);
  writeJson(all);
  return item;
}

export async function deleteContent(id: string): Promise<boolean> {
  const all = readJson();
  const next = all.filter((c) => c.id !== id);
  if (next.length === all.length) return false;
  writeJson(next);
  return true;
}

export async function clearContent(): Promise<void> {
  writeJson([]);
}
