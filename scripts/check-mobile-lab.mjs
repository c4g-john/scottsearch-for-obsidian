import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const labRoot = resolve(root, 'research/mobile-on-device-lab/dist');
const labBundle = readFileSync(resolve(labRoot, 'main.js'), 'utf8');
const releaseBundle = readFileSync(resolve(root, 'main.js'), 'utf8');
const labManifest = JSON.parse(readFileSync(resolve(labRoot, 'manifest.json'), 'utf8'));
const rootManifest = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8'));
const safetyNotice = readFileSync(resolve(labRoot, 'SAFETY_NOTICE.md'), 'utf8');
const gitignore = readFileSync(resolve(root, '.gitignore'), 'utf8');
const releaseWorkflow = readFileSync(resolve(root, '.github/workflows/release.yml'), 'utf8');

const errors = [];
check(labManifest.id === 'scottsearch-mobile-lab', 'Lab manifest must have its distinct plugin id.');
check(labManifest.name === 'ScottSearch Mobile Lab', 'Lab manifest must have its distinct warning name.');
check(labManifest.version === rootManifest.version, 'Lab and source versions must match.');
check(labManifest.minAppVersion === rootManifest.minAppVersion, 'Lab and source minimum Obsidian versions must match.');
check(labManifest.isDesktopOnly === false, 'Lab manifest must allow the controlled mobile test.');
for (const file of ['main.js', 'manifest.json', 'styles.css', 'SAFETY_NOTICE.md']) {
  check(statSync(resolve(labRoot, file)).size > 0, `Lab artifact is empty: ${file}.`);
}
for (const marker of [
  'onnxruntime-web@1.29.0',
  'Mobile on-device lab',
  'huggingface.co/Snowflake',
  'model_int8.onnx',
]) {
  check(labBundle.includes(marker), `Lab bundle is missing expected marker: ${marker}.`);
  check(!releaseBundle.includes(marker), `Normal release bundle contains lab marker: ${marker}.`);
}
for (const forbidden of [
  'require("electron")',
  "require('electron')",
  'require("node:',
  "require('node:",
]) {
  check(!labBundle.includes(forbidden), `Lab bundle contains forbidden Node/Electron import: ${forbidden}.`);
}
check(safetyNotice.includes('Never use this build with a personal vault'), 'Lab safety notice must prohibit personal-vault use.');
check(safetyNotice.includes('not a release'), 'Lab safety notice must state that the artifact is not a release.');
check(gitignore.includes('/research/mobile-on-device-lab/dist/'), 'Generated lab artifacts must be ignored by Git.');
check(!releaseWorkflow.includes('research/mobile-on-device-lab'), 'Release workflow must not reference the mobile lab output.');

if (errors.length > 0) {
  console.error('Mobile lab audit failed:');
  for (const error of errors) console.error(`  - ${error}`);
  process.exitCode = 1;
} else {
  const digest = createHash('sha256').update(readFileSync(resolve(labRoot, 'main.js'))).digest('hex');
  console.log('Mobile lab audit passed.');
  console.log(`main.js: ${statSync(resolve(labRoot, 'main.js')).size} bytes; sha256:${digest}`);
  console.log('Distinct manifest, safety notice, expected browser runtime, no Node/Electron imports, and release isolation verified.');
}

function check(condition, message) {
  if (!condition) errors.push(message);
}
