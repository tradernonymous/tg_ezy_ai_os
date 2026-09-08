import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { requestMagicToken, verifyMagicToken } from '../magic';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-os-magic-'));

beforeEach(() => {
  process.env.DATA_DIR = tempRoot;
  fs.rmSync(tempRoot, { recursive: true, force: true });
  fs.mkdirSync(tempRoot, { recursive: true });
});

test('magic: dev preview returns the code; verify consumes it', () => {
  process.env.MAGIC_DEV_PREVIEW = 'true';
  const d = requestMagicToken('user@x.io');
  assert.equal(d.delivered, 'preview');
  const code = (d as { code: string }).code;
  assert.match(code, /^\d{6}$/);
  assert.equal(verifyMagicToken('user@x.io', code), true);
  assert.equal(verifyMagicToken('user@x.io', code), false, 'one-time code must be single use');
});

test('magic: wrong or missing codes fail', () => {
  process.env.MAGIC_DEV_PREVIEW = 'true';
  requestMagicToken('user2@x.io');
  assert.equal(verifyMagicToken('user2@x.io', '000000'), false);
  assert.equal(verifyMagicToken('nobody@x.io', '123456'), false);
});