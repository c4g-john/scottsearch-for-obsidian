import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const vitest = resolve('node_modules/vitest/vitest.mjs');
const result = spawnSync(
  process.execPath,
  [vitest, 'run', 'tests/relevance-evaluation.test.ts', '--reporter=verbose'],
  {
    env: { ...process.env, SCOTTSEARCH_RELEVANCE_REPORT: '1' },
    stdio: 'inherit',
  },
);

process.exitCode = result.status ?? 1;
