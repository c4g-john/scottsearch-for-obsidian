import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const STRICT_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const BASIC_LATIN = /^[\x20-\x7e]+$/u;
const RELEASE_MARKERS = [
  'onnxruntime-web@',
  'model_int8.onnx',
  'huggingface.co/Snowflake',
  'On-device model experiment',
];

export function validateManifest(manifest, packageJson, versions) {
  const errors = [];
  check(errors, typeof manifest.id === 'string' && /^[a-z][a-z0-9-]*$/u.test(manifest.id), 'manifest.id must use lowercase letters, numbers, and hyphens.');
  check(errors, !manifest.id?.includes('obsidian'), 'manifest.id must not contain “obsidian”.');
  check(errors, !manifest.id?.endsWith('plugin'), 'manifest.id must not end with “plugin”.');
  check(errors, typeof manifest.name === 'string' && manifest.name.length > 0 && BASIC_LATIN.test(manifest.name), 'manifest.name must use non-empty Basic Latin text.');
  check(errors, !/^obsi/ui.test(manifest.name ?? '') && !/sidian$/ui.test(manifest.name ?? '') && !/plugin$/ui.test(manifest.name ?? ''), 'manifest.name must not imitate Obsidian branding or end with “plugin”.');
  check(errors, typeof manifest.version === 'string' && STRICT_SEMVER.test(manifest.version), 'manifest.version must be strict x.y.z SemVer.');
  check(errors, typeof manifest.minAppVersion === 'string' && STRICT_SEMVER.test(manifest.minAppVersion), 'manifest.minAppVersion must be strict x.y.z SemVer.');
  check(errors, typeof manifest.description === 'string' && manifest.description.length > 0 && manifest.description.length <= 250, 'manifest.description must contain 1–250 characters.');
  check(errors, BASIC_LATIN.test(manifest.description ?? ''), 'manifest.description must use Basic Latin text.');
  check(errors, manifest.description?.endsWith('.'), 'manifest.description must end with a period.');
  check(errors, typeof manifest.author === 'string' && manifest.author.trim().length > 0, 'manifest.author is required.');
  check(errors, isHttpsUrl(manifest.authorUrl), 'manifest.authorUrl must be an HTTPS URL.');
  check(errors, typeof manifest.isDesktopOnly === 'boolean', 'manifest.isDesktopOnly must be a boolean.');
  check(errors, packageJson.version === manifest.version, 'package.json and manifest.json versions must match.');
  check(errors, packageJson.license === 'MIT', 'package.json must declare the repository MIT license.');
  check(errors, packageJson.devDependencies?.['eslint-plugin-obsidianmd'] !== undefined, 'The official eslint-plugin-obsidianmd package must be installed.');
  check(errors, packageJson.scripts?.lint?.includes('eslint'), 'package.json must expose the official ESLint gate.');
  check(errors, versions[manifest.version] === manifest.minAppVersion, 'versions.json must map the current version to its minimum Obsidian version.');
  for (const [version, minimum] of Object.entries(versions)) {
    check(errors, STRICT_SEMVER.test(version), `versions.json contains an invalid plugin version: ${version}.`);
    check(errors, typeof minimum === 'string' && STRICT_SEMVER.test(minimum), `versions.json contains an invalid Obsidian version for ${version}.`);
  }
  return errors;
}

export function validateCommunityRepository(root) {
  const errors = [];
  const requiredFiles = [
    'README.md',
    'LICENSE',
    'manifest.json',
    'versions.json',
    'main.js',
    'styles.css',
    '.github/workflows/release.yml',
  ];
  for (const file of requiredFiles) {
    check(errors, existsSync(join(root, file)), `Required file is missing: ${file}.`);
  }
  if (errors.length > 0) return errors;

  const manifest = readJson(root, 'manifest.json', errors);
  const packageJson = readJson(root, 'package.json', errors);
  const versions = readJson(root, 'versions.json', errors);
  if (manifest && packageJson && versions) {
    errors.push(...validateManifest(manifest, packageJson, versions));
  }

  for (const file of ['main.js', 'styles.css']) {
    check(errors, statSync(join(root, file)).size > 0, `Built release asset is empty: ${file}.`);
  }

  const bundle = readFileSync(join(root, 'main.js'), 'utf8');
  for (const marker of RELEASE_MARKERS) {
    check(errors, !bundle.includes(marker), `Release bundle contains unreleased on-device marker: ${marker}.`);
  }

  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  check(errors, /install the human-testing release/iu.test(readme), 'README must include human-testing installation instructions.');
  check(errors, /note text is sent to whichever endpoint you configure/iu.test(readme), 'README must disclose where Ollama sends note text.');
  check(errors, /does not include analytics or telemetry/iu.test(readme), 'README must disclose the telemetry policy.');
  check(errors, /## License/iu.test(readme), 'README must identify the license.');

  const releaseWorkflow = readFileSync(join(root, '.github/workflows/release.yml'), 'utf8');
  check(errors, /tags:\s*[\s\S]*?"\*\.\*\.\*"/u.test(releaseWorkflow), 'Release workflow must run for exact x.y.z tags.');
  for (const asset of ['main.js', 'manifest.json', 'styles.css']) {
    check(errors, releaseWorkflow.includes(asset), `Release workflow must publish ${asset}.`);
  }
  check(errors, /attestations:\s*write/u.test(releaseWorkflow), 'Release workflow must grant attestations: write.');
  check(errors, /id-token:\s*write/u.test(releaseWorkflow), 'Release workflow must grant id-token: write.');
  check(errors, /uses:\s*actions\/attest@v4/u.test(releaseWorkflow), 'Release workflow must attest its published assets with actions/attest@v4.');

  return errors;
}

function readJson(root, file, errors) {
  try {
    return JSON.parse(readFileSync(join(root, file), 'utf8'));
  } catch (error) {
    errors.push(`${file} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function check(errors, condition, message) {
  if (!condition) errors.push(message);
}

function isHttpsUrl(value) {
  try {
    return typeof value === 'string' && new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}
