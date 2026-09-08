import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { saveState, loadState, loadStateWithRecovery, dataDir } from '../stateStore';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-os-state-'));

beforeEach(() => {
  process.env.DATA_DIR = tempRoot;
  fs.rmSync(tempRoot, { recursive: true, force: true });
  fs.mkdirSync(tempRoot, { recursive: true });
});

test('stateStore: dataDir honors DATA_DIR', () => {
  assert.equal(dataDir(), tempRoot);
});

test('stateStore: save + load round-trips data', () => {
  const s = { '6282941580': { type: 'idle', plan: 'pro' }, __meta: { seeded: true } };
  saveState(s);
  const loaded = loadState();
  assert.deepEqual(loaded, s);
});

test('stateStore: corrupt main file falls back to .bak via recovery helper', () => {
  saveState({ '1': { type: 'idle' } });
  saveState({ '1': { type: 'idle', plan: 'pro' } });
  const main = path.join(tempRoot, 'state.json');
  fs.writeFileSync(main, '{ corrupted json', 'utf-8');
  const recovered = loadStateWithRecovery();
  assert.equal(recovered.recovered, true);
  assert.deepEqual(recovered.state, { '1': { type: 'idle' } });
});

test('stateStore: loadState on totally missing file returns {}', () => {
  process.env.DATA_DIR = path.join(os.tmpdir(), 'tg-os-state-missing-' + Date.now());
  assert.deepEqual(loadState(), {});
});