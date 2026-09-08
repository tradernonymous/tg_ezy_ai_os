import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const testsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', '__tests__');
const files = readdirSync(testsDir)
  .filter((f) => f.endsWith('.test.js'))
  .map((f) => join(testsDir, f));
const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(result.status === null ? 1 : result.status);