import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repository = 'c4g-john/scottsearch-for-obsidian';
const root = resolve(import.meta.dirname, '..');
const localManifest = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8'));
const options = parseArguments(process.argv.slice(2));
const version = options.version ?? localManifest.version;
const apiHeaders = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'ScottSearch-community-preflight',
  ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
};

const [repositoryRecord, catalog, release, expectedManifest] = await Promise.all([
  fetchJson(`https://api.github.com/repos/${repository}`, apiHeaders),
  fetchJson('https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugins.json'),
  fetchJson(`https://api.github.com/repos/${repository}/releases/tags/${version}`, apiHeaders),
  version === localManifest.version
    ? localManifest
    : fetchJson(`https://raw.githubusercontent.com/${repository}/${version}/manifest.json`),
]);

const errors = [];
if (repositoryRecord.private) errors.push('The GitHub repository is not public.');
if (!repositoryRecord.default_branch) errors.push('The GitHub repository has no default branch.');

const collision = catalog.find((entry) => (
  (entry.id === expectedManifest.id || entry.name?.toLocaleLowerCase() === expectedManifest.name.toLocaleLowerCase())
  && entry.repo?.toLocaleLowerCase() !== repository.toLocaleLowerCase()
));
if (collision) errors.push(`Community catalog collision with ${collision.repo}: ${collision.id} / ${collision.name}.`);

if (release.draft) errors.push(`Release ${version} is still a draft.`);
if (release.prerelease && !options.allowPrerelease) {
  errors.push(`Release ${version} is a pre-release; the stable Community gate requires a non-prerelease release.`);
}
const assets = new Map(release.assets.map((asset) => [asset.name, asset]));
for (const name of ['main.js', 'manifest.json', 'styles.css']) {
  if (!assets.has(name)) errors.push(`Release ${version} is missing ${name}.`);
}
const releaseManifestAsset = assets.get('manifest.json');
if (releaseManifestAsset) {
  const releaseManifest = await fetchJson(releaseManifestAsset.browser_download_url);
  if (canonicalJson(releaseManifest) !== canonicalJson(expectedManifest)) {
    errors.push(`Release ${version} manifest.json does not match the manifest at tag ${version}.`);
  }
}

if (errors.length > 0) {
  console.error(`Live Community release preflight failed for ${repository}@${version}:`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Live Community release preflight passed for ${repository}@${version}.`);
  console.log(`Repository: public; default branch: ${repositoryRecord.default_branch}.`);
  console.log(`Catalog: no conflicting id or name; release assets: main.js, manifest.json, styles.css.`);
  console.log(`Release state: ${release.prerelease ? 'pre-release accepted for inspection' : 'stable'}.`);
}

function parseArguments(arguments_) {
  const result = { allowPrerelease: false, version: undefined };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === '--allow-prerelease') result.allowPrerelease = true;
    else if (argument === '--version') result.version = arguments_[index += 1];
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (result.version && !/^\d+\.\d+\.\d+$/u.test(result.version)) {
    throw new Error('--version must be strict x.y.z SemVer.');
  }
  return result;
}

async function fetchJson(url, headers = {}) {
  const response = await fetch(url, { headers, redirect: 'follow' });
  if (!response.ok) throw new Error(`HTTP ${response.status} while reading ${url}`);
  return response.json();
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
