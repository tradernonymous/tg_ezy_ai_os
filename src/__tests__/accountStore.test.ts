import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createAccount, getAccount, getAccountByProviderKey, updateAccount, countAccounts } from '../accountStore';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-os-accts-'));

beforeEach(() => {
  process.env.DATA_DIR = tempRoot;
  fs.rmSync(tempRoot, { recursive: true, force: true });
  fs.mkdirSync(tempRoot, { recursive: true });
});

test('accountStore: first account becomes owner preview (thinker), later are free', async () => {
  const first = await createAccount({ provider: 'google', providerKey: 'sub-1', name: 'Ada' });
  assert.equal(first.plan, 'thinker');
  const second = await createAccount({ provider: 'telegram', providerKey: '555001', name: 'Bob' });
  assert.equal(second.plan, 'free');
  assert.equal(countAccounts(), 2);
});

test('accountStore: provider-key lookup + updates', async () => {
  const a = await createAccount({ provider: 'magic', providerKey: 'a@x.io', legacyPlan: 'pro' });
  assert.equal(getAccountByProviderKey('magic', 'a@x.io')!.id, a.id);
  const b = await createAccount({ provider: 'magic', providerKey: 'a@x.io', name: 'dup' });
  assert.equal(b.id, a.id, 'duplicate create should return existing account');
  const updated = updateAccount(a.id, { plan: 'thinker', name: 'Ada L.' });
  assert.equal(updated!.plan, 'thinker');
  assert.equal(getAccount(a.id)!.name, 'Ada L.');
});

test('accountStore: legacy plan is normalized through the 5-tier map', async () => {
  const a = await createAccount({ provider: 'telegram', providerKey: '99001', legacyPlan: 'enterprise' });
  assert.equal(a.plan, 'thinker');
});