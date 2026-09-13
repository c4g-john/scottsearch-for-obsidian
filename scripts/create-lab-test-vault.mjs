import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '..');
const labKind = process.argv[2];
if (labKind !== 'desktop' && labKind !== 'mobile') {
  throw new Error('Choose desktop or mobile as the first argument.');
}
const temporaryRoot = resolve(tmpdir());
const target = resolve(process.argv[3] ?? join(temporaryRoot, `scottsearch-${labKind}-lab-test`));
const expectedName = new RegExp(`^scottsearch-${labKind}-lab-[a-zA-Z0-9._-]+$`, 'u');
if (dirname(target) !== temporaryRoot || !expectedName.test(basename(target))) {
  throw new Error(`Choose a new scottsearch-${labKind}-lab-* directory directly inside ${temporaryRoot}.`);
}
if (existsSync(target)) throw new Error(`Target already exists: ${target}`);

const labName = labKind === 'desktop' ? 'desktop-on-device-lab' : 'mobile-on-device-lab';
const expectedId = `scottsearch-${labKind}-lab`;
const labRoot = join(repositoryRoot, 'research', labName);
const distribution = join(labRoot, 'dist');
for (const file of ['main.js', 'manifest.json', 'styles.css', 'SAFETY_NOTICE.md', 'EXPECTED_SHA256']) {
  if (!existsSync(join(distribution, file)) || statSync(join(distribution, file)).size === 0) {
    throw new Error(`Build and audit the ${labKind} lab before creating its test vault: missing ${file}.`);
  }
}

const manifest = JSON.parse(readFileSync(join(distribution, 'manifest.json'), 'utf8'));
if (manifest.id !== expectedId) throw new Error(`Unexpected lab plugin id: ${String(manifest.id)}`);
if (manifest.isDesktopOnly !== (labKind === 'desktop')) {
  throw new Error(`Unexpected ${labKind} lab platform flag.`);
}
const expectedDigest = readFileSync(join(labRoot, 'EXPECTED_SHA256'), 'utf8').trim();
const packagedDigest = readFileSync(join(distribution, 'EXPECTED_SHA256'), 'utf8').trim();
const mainBytes = readFileSync(join(distribution, 'main.js'));
const actualDigest = createHash('sha256').update(mainBytes).digest('hex');
if (actualDigest !== expectedDigest || packagedDigest !== expectedDigest) {
  throw new Error(`Refusing unreviewed ${labKind} lab bytes: ${actualDigest}.`);
}

mkdirSync(target);
const configurationDirectory = join(target, '.obsidian');
const pluginDirectory = join(configurationDirectory, 'plugins', expectedId);
mkdirSync(pluginDirectory, { recursive: true });
for (const file of ['main.js', 'manifest.json', 'styles.css', 'SAFETY_NOTICE.md', 'EXPECTED_SHA256']) {
  copyFileSync(join(distribution, file), join(pluginDirectory, file));
}
writeJson(join(configurationDirectory, 'community-plugins.json'), [expectedId]);
writeJson(join(configurationDirectory, 'app.json'), {});
writeJson(join(pluginDirectory, 'data.json'), {
  embeddings: {},
  settings: {
    embeddingBatchSize: 8,
    ignoredFolders: [],
    maxFileSizeKb: 1024,
    ollamaEndpoint: 'http://localhost:11434',
    ollamaModel: 'embeddinggemma',
    resultLimit: 10,
    searchDelayMs: 650,
    semanticEnabled: false,
    semanticProvider: 'on-device',
    semanticWeight: 0.78,
  },
});

const catalog = JSON.parse(readFileSync(join(repositoryRoot, 'benchmarks/corpus/catalog.json'), 'utf8'));
const notesDirectory = join(target, 'Synthetic benchmark');
mkdirSync(notesDirectory);
const corpusHash = createHash('sha256');
for (let index = 0; index < 1_000; index += 1) {
  const entry = catalog[index % catalog.length];
  const content = readFileSync(join(repositoryRoot, 'benchmarks/corpus', entry.file), 'utf8');
  const note = [
    '---',
    `tags: [${entry.tags.join(', ')}]`,
    '---',
    '',
    content,
    '',
    `Synthetic test copy ${index + 1}.`,
  ].join('\n');
  const filename = `${String(index + 1).padStart(4, '0')} ${basename(entry.file)}`;
  writeFileSync(join(notesDirectory, filename), note);
  corpusHash.update(filename).update('\0').update(note).update('\0');
}

writeJson(join(target, 'SCOTTSEARCH_LAB_IDENTITY.json'), {
  corpusSha256: corpusHash.digest('hex'),
  labKind,
  mainSha256: actualDigest,
  notes: 1_000,
  pluginId: expectedId,
  pluginVersion: manifest.version,
});

console.log(JSON.stringify({
  labKind,
  mainSha256: actualDigest,
  notes: 1_000,
  pluginDirectory,
  pluginId: expectedId,
  target,
}, null, 2));

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}
