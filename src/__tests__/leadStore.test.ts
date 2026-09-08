import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  getLeads,
  getLeadsForAccount,
  adoptUnownedLeads,
  addLead,
  updateLead,
  updateLeadByTelegramId,
  deleteLead,
  clearLeads,
  toCsv,
} from '../leadStore';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-os-leads-'));

beforeEach(() => {
  process.env.DATA_DIR = tempRoot;
  fs.rmSync(tempRoot, { recursive: true, force: true });
  fs.mkdirSync(tempRoot, { recursive: true });
});

test('leadStore: addLead requires telegramId', async () => {
  await assert.rejects(() => addLead({} as any), /telegramId is required/);
});

test('leadStore: addLead persists new lead with defaults', async () => {
  const lead = await addLead({ telegramId: '111', name: 'Ada', stage: 'qualified', channel: 'email', email: 'a@x.io', value: 500 });
  assert.equal(lead.stage, 'qualified');
  assert.equal(lead.channel, 'email');
  assert.equal(lead.value, 500);
  const all = await getLeads();
  assert.equal(all.length, 1);
  assert.equal(all[0].name, 'Ada');
});

test('leadStore: addLead upserts existing telegramId instead of duplicating', async () => {
  await addLead({ telegramId: '222', name: 'First' });
  const updated = await addLead({ telegramId: '222', name: 'Renamed' });
  assert.equal(updated.name, 'Renamed');
  const all = await getLeads();
  assert.equal(all.length, 1);
});

test('leadStore: sanitize clamps stage and value', async () => {
  const lead = await addLead({ telegramId: '333', stage: 'negotiation', value: -100 });
  assert.equal(lead.stage, 'new');
  assert.equal(lead.value, 0);
});

test('leadStore: updateLead + updateLeadByTelegramId + deleteLead', async () => {
  const a = await addLead({ telegramId: '444', name: 'Gemma' });
  const updated = await updateLead(a.id, { stage: 'contacted', tags: ['hot'], owner: 'me' });
  assert.equal(updated!.stage, 'contacted');
  assert.deepEqual(updated!.tags, ['hot']);

  const byTg = await updateLeadByTelegramId('444', { stage: 'closed' });
  assert.equal(byTg!.stage, 'closed');

  assert.equal(await deleteLead(a.id), true);
  assert.equal(await deleteLead(a.id), false);
  assert.equal((await getLeads()).length, 0);
});

test('leadStore: toCsv escapes commas and quotes', async () => {
  await clearLeads();
  await addLead({ telegramId: '555', name: 'Quoted, "Name"' });
  const csv = toCsv(await getLeads());
  assert.ok(csv.includes('"Quoted, ""Name"""'));
  assert.ok(csv.split('\n')[0].includes('telegramId'), 'header should contain telegramId');
});

test('leadStore: owner scoping + adoptUnownedLeads (per-account data model)', async () => {
  await addLead({ telegramId: 'a1', name: 'No owner yet' });
  await addLead({ telegramId: 'a2', name: 'Already owned', accountId: 'acc-x' });
  assert.equal((await getLeadsForAccount('acc-x')).length, 1);
  const adopted = await adoptUnownedLeads('acc-x');
  assert.equal(adopted, 1, 'first account adopts the unowned demo lead');
  assert.equal((await getLeadsForAccount('acc-x')).length, 2);
  assert.equal((await getLeadsForAccount('acc-y')).length, 0);
});