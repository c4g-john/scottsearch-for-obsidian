import { resolve } from 'node:path';

import { validateCommunityRepository } from './community-readiness-lib.mjs';

const root = resolve(import.meta.dirname, '..');
const errors = validateCommunityRepository(root);

if (errors.length > 0) {
  console.error('Obsidian Community readiness preflight failed:');
  for (const error of errors) console.error(`  - ${error}`);
  process.exitCode = 1;
} else {
  console.log('Obsidian Community readiness preflight passed.');
  console.log('Release metadata, required files, disclosures, safe bundle, packaging, and provenance controls agree.');
}
