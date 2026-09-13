import assert from 'node:assert/strict';
import test from 'node:test';

import { validateManifest } from './community-readiness-lib.mjs';

const validManifest = {
  author: 'c4g-john',
  authorUrl: 'https://github.com/c4g-john',
  description: 'Fast, relevance-ranked vault search with filters, snippets, and keyboard navigation.',
  id: 'scottsearch',
  isDesktopOnly: false,
  minAppVersion: '1.7.2',
  name: 'ScottSearch',
  version: '0.1.1',
};
const validPackage = {
  devDependencies: { 'eslint-plugin-obsidianmd': '^0.4.2' },
  license: 'MIT',
  scripts: { lint: 'eslint src tests' },
  version: '0.1.1',
};

test('accepts the release manifest contract', () => {
  assert.deepEqual(validateManifest(validManifest, validPackage, { '0.1.1': '1.7.2' }), []);
});

test('rejects incompatible, branded, or unsynchronized metadata', () => {
  const errors = validateManifest(
    {
      ...validManifest,
      description: 'No punctuation',
      id: 'Obsidian_Search_plugin',
      minAppVersion: '1.7',
      name: 'Obsidian Search Plugin',
    },
    { ...validPackage, version: '0.1.0' },
    { '0.1.1': '1.5.0' },
  );
  assert.ok(errors.length >= 7);
  assert.ok(errors.some((error) => error.includes('versions.json')));
  assert.ok(errors.some((error) => error.includes('versions must match')));
});

