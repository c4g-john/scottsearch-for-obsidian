import { createHash } from 'node:crypto';
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '..');
const target = resolve(process.argv[2] ?? '');
const modelFixture = resolve(process.argv[3] ?? '');
if (!/^\/(?:private\/)?tmp\/scottsearch-obsidian-[a-zA-Z0-9._-]+$/u.test(target)) {
  throw new Error('Choose a new /tmp/scottsearch-obsidian-* target directory.');
}
if (!modelFixture.startsWith('/tmp/scottsearch-model-')) {
  throw new Error('Choose the reviewed /tmp/scottsearch-model-* fixture directory.');
}

const modelRevision = 'd8c86521100d3556476a063fc2342036d45c106f';
const cacheKey = `snowflake-arctic-embed-xs-int8-${modelRevision.slice(0, 12)}`;
const artifacts = [
  ['config.json', 'config.json', 737, 'd7d071046ab952af96b7abad788db7ab3fc997b465e1b9914ff39707092254ec'],
  ['tokenizer.json', 'tokenizer.json', 711_649, '91f1def9b9391fdabe028cd3f3fcc4efd34e5d1f08c3bf2de513ebb5911a1854'],
  ['tokenizer_config.json', 'tokenizer_config.json', 1_433, '9ca59277519f6e3692c8685e26b94d4afca2d5438deff66483db495e48735810'],
  ['model_int8.onnx', 'onnx/model_int8.onnx', 22_972_992, 'e6aa5e656466a73d7c3111e9a3378bd13e5b93af30eaac2b3f13fd56692589a1'],
];

mkdirSync(target);
const configurationDirectory = join(target, '.obsidian');
const pluginDirectory = join(configurationDirectory, 'plugins', 'scottsearch');
const modelDirectory = join(pluginDirectory, 'model-assets', cacheKey);
mkdirSync(pluginDirectory, { recursive: true });
mkdirSync(join(modelDirectory, 'onnx'), { recursive: true });

for (const file of ['main.js', 'manifest.json', 'styles.css']) {
  copyFileSync(join(repositoryRoot, file), join(pluginDirectory, file));
}
for (const [sourceName, destinationName, bytes, digest] of artifacts) {
  const source = join(modelFixture, sourceName);
  const data = readFileSync(source);
  if (statSync(source).size !== bytes || createHash('sha256').update(data).digest('hex') !== digest) {
    throw new Error(`Model fixture validation failed for ${sourceName}.`);
  }
  copyFileSync(source, join(modelDirectory, destinationName));
}

const fingerprint = [
  1,
  'Snowflake/snowflake-arctic-embed-xs',
  modelRevision,
  cacheKey,
  ...artifacts.map(([, destinationName, bytes, digest]) => `${destinationName}:${bytes}:${digest}`),
].join('\n');
writeJson(join(modelDirectory, 'scottsearch-model.json'), {
  fingerprint,
  installedAt: new Date().toISOString(),
  schemaVersion: 1,
  totalBytes: 23_686_811,
});
writeJson(join(configurationDirectory, 'community-plugins.json'), ['scottsearch']);
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
    semanticEnabled: true,
    semanticProvider: 'on-device',
    semanticWeight: 0.78,
  },
});

const catalog = JSON.parse(readFileSync(join(repositoryRoot, 'benchmarks/corpus/catalog.json'), 'utf8'));
const notesDirectory = join(target, 'Synthetic benchmark');
mkdirSync(notesDirectory);
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
  writeFileSync(join(notesDirectory, `${String(index + 1).padStart(4, '0')} ${basename(entry.file)}`), note);
}

console.log(JSON.stringify({ notes: 1_000, pluginDirectory, target }, null, 2));

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}
