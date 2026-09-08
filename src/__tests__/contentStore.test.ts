import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  listContentForAccount,
  getContent,
  addContent,
  updateContent,
  setContentStatus,
  setContentStarred,
  deleteContent,
  clearContent,
} from '../contentStore';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-os-content-'));

beforeEach(() => {
  process.env.DATA_DIR = tempRoot;
  fs.rmSync(tempRoot, { recursive: true, force: true });
  fs.mkdirSync(tempRoot, { recursive: true });
});

test('contentStore: addContent defaults to draft, unstarred, with a created entry', async () => {
  const item = await addContent({ accountId: 'a1', title: 'Hook', body: 'text' });
  assert.equal(item.status, 'draft');
  assert.equal(item.starred, false);
  assert.equal(item.kind, 'copy');
  assert.equal(item.activity.length, 1);
  assert.equal(item.activity[0].action, 'created');
  assert.equal(item.activity[0].actor, 'a1');
});

test('contentStore: unknown kind falls back to copy', async () => {
  const item = await addContent({ accountId: 'a1', kind: 'nonsense', title: 'x' });
  assert.equal(item.kind, 'copy');
});

test('contentStore: empty title becomes Untitled', async () => {
  const item = await addContent({ accountId: 'a1' });
  assert.equal(item.title, 'Untitled');
});

test('contentStore: listContentForAccount isolates accounts', async () => {
  await addContent({ accountId: 'a1', title: 'mine' });
  await addContent({ accountId: 'a2', title: 'theirs' });
  const mine = await listContentForAccount('a1');
  assert.equal(mine.length, 1);
  assert.equal(mine[0].title, 'mine');
});

test('contentStore: filters by kind, status and starred', async () => {
  const a = await addContent({ accountId: 'a1', kind: 'research', title: 'r' });
  await addContent({ accountId: 'a1', kind: 'copy', title: 'c' });
  await setContentStatus(a.id, 'approved', 'a1');
  await setContentStarred(a.id, true, 'a1');

  assert.equal((await listContentForAccount('a1', { kind: 'research' })).length, 1);
  assert.equal((await listContentForAccount('a1', { status: 'approved' })).length, 1);
  assert.equal((await listContentForAccount('a1', { starred: true })).length, 1);
  assert.equal((await listContentForAccount('a1', { starred: false })).length, 1);
});

test('contentStore: date range filters on scheduledFor, falling back to createdAt', async () => {
  await addContent({ accountId: 'a1', title: 'sched', scheduledFor: '2026-10-01T00:00:00.000Z' });
  const inRange = await listContentForAccount('a1', {
    from: '2026-09-01T00:00:00.000Z',
    to: '2026-11-01T00:00:00.000Z',
  });
  assert.equal(inRange.length, 1);

  const outOfRange = await listContentForAccount('a1', {
    from: '2026-01-01T00:00:00.000Z',
    to: '2026-02-01T00:00:00.000Z',
  });
  assert.equal(outOfRange.length, 0);
});

test('contentStore: invalid scheduledFor is dropped, not stored as Invalid Date', async () => {
  const item = await addContent({ accountId: 'a1', title: 'x', scheduledFor: 'not-a-date' });
  assert.equal(item.scheduledFor, undefined);
});

test('contentStore: approving records an approved event with the actor', async () => {
  const item = await addContent({ accountId: 'a1', title: 'x' });
  const approved = await setContentStatus(item.id, 'approved', 'editor-1');
  assert.equal(approved?.status, 'approved');
  const last = approved!.activity.at(-1)!;
  assert.equal(last.action, 'approved');
  assert.equal(last.actor, 'editor-1');
});

test('contentStore: moving backwards records a reverted event, not an approval', async () => {
  const item = await addContent({ accountId: 'a1', title: 'x' });
  await setContentStatus(item.id, 'published', 'a1');
  const reverted = await setContentStatus(item.id, 'draft', 'a1');
  const last = reverted!.activity.at(-1)!;
  assert.equal(last.action, 'reverted');
  assert.equal(last.note, 'published -> draft');
});

test('contentStore: rejects an unknown status', async () => {
  const item = await addContent({ accountId: 'a1', title: 'x' });
  const result = await setContentStatus(item.id, 'bogus' as any, 'a1');
  assert.equal(result, null);
  assert.equal((await getContent(item.id))?.status, 'draft');
});

test('contentStore: starred is independent of approved', async () => {
  const item = await addContent({ accountId: 'a1', title: 'x' });
  await setContentStarred(item.id, true, 'a1');
  const fetched = await getContent(item.id);
  assert.equal(fetched?.starred, true);
  assert.equal(fetched?.status, 'draft');
});

test('contentStore: updateContent patches only known fields', async () => {
  const item = await addContent({ accountId: 'a1', title: 'old' });
  const updated = await updateContent(item.id, { title: 'new', status: 'published' }, 'a1');
  assert.equal(updated?.title, 'new');
  assert.equal(updated?.status, 'draft'); // status is not patchable here
});

test('contentStore: updateContent and setters return null for a missing id', async () => {
  assert.equal(await updateContent('nope', { title: 'x' }), null);
  assert.equal(await setContentStatus('nope', 'approved'), null);
  assert.equal(await setContentStarred('nope', true), null);
});

test('contentStore: deleteContent reports whether anything was removed', async () => {
  const item = await addContent({ accountId: 'a1', title: 'x' });
  assert.equal(await deleteContent(item.id), true);
  assert.equal(await deleteContent(item.id), false);
  assert.equal((await listContentForAccount('a1')).length, 0);
});

test('contentStore: corrupt store file resets instead of throwing', async () => {
  await addContent({ accountId: 'a1', title: 'x' });
  fs.writeFileSync(path.join(tempRoot, 'content.json'), '{not json', 'utf-8');
  assert.deepEqual(await listContentForAccount('a1'), []);
});

test('contentStore: clearContent empties the store', async () => {
  await addContent({ accountId: 'a1', title: 'x' });
  await clearContent();
  assert.equal((await listContentForAccount('a1')).length, 0);
});
