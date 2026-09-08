import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  CHANNELS,
  seedIfEmpty,
  getConversations,
  getConversation,
  markRead,
  reply,
  unreadTotals,
} from '../inbox';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-os-inbox-'));

beforeEach(() => {
  process.env.DATA_DIR = tempRoot;
  delete process.env.INBOX_SIM;
  fs.rmSync(tempRoot, { recursive: true, force: true });
  fs.mkdirSync(tempRoot, { recursive: true });
});

test('inbox: seedIfEmpty creates one conversation per channel', () => {
  seedIfEmpty();
  const convs = getConversations();
  assert.ok(convs.length >= 5, `expected >=5 conversations, got ${convs.length}`);
  const channels = new Set(convs.map((c) => c.channel));
  for (const ch of CHANNELS) assert.ok(channels.has(ch), `channel ${ch} missing`);
});

test('inbox: seedIfEmpty is idempotent', () => {
  seedIfEmpty();
  const before = getConversations().length;
  seedIfEmpty();
  assert.equal(getConversations().length, before);
});

test('inbox: INBOX_SIM=false disables seeding', () => {
  process.env.INBOX_SIM = 'false';
  seedIfEmpty();
  assert.equal(getConversations().length, 0);
});

test('inbox: unreadTotals + markRead', () => {
  seedIfEmpty();
  const { total, byChannel } = unreadTotals();
  assert.ok(total >= 1, `expected unread >=1, got ${total}`);
  const keys = Object.keys(byChannel);
  assert.ok(keys.length >= 1, 'at least one channel has unread');

  const busy = getConversations().find((c) => c.unread > 0)!;
  const marked = markRead(busy.id);
  assert.equal(marked!.unread, 0);
  assert.equal(unreadTotals().total, total - busy.unread);
});

test('inbox: reply appends agent message and updates lastAt', () => {
  seedIfEmpty();
  const conv = getConversations()[0];
  const before = conv.lastAt;
  const updated = reply(conv.id, 'Thanks! Sending details now.');
  assert.ok(updated!.messages.some((m) => m.from === 'agent' && m.text.includes('Thanks!')));
  assert.ok(updated!.lastAt >= before);
});

test('inbox: getConversation returns undefined for unknown id', () => {
  assert.equal(getConversation('nope'), undefined);
});