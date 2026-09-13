import { readFileSync } from 'node:fs';
import { arch, platform, release, totalmem } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(here, '../..');
const runLabel = readArgument('--run') ?? 'unlabeled';
const candidateName = readArgument('--candidate') ?? 'arctic-xs';
const verbose = readArgument('--verbose') === 'true';

const candidates = {
  'arctic-xs': {
    dtype: 'int8',
    id: 'Snowflake/snowflake-arctic-embed-xs',
    pooling: 'cls',
    queryPrefix: 'Represent this sentence for searching relevant passages: ',
    revision: 'd8c86521100d3556476a063fc2342036d45c106f',
  },
  'mxbai-xsmall': {
    dtype: 'int8',
    id: 'mixedbread-ai/mxbai-embed-xsmall-v1',
    pooling: 'mean',
    queryPrefix: '',
    revision: 'e6ac24e5d6efb8782b59de1647b3ececb4ece94e',
  },
};

const candidate = candidates[candidateName];
if (!candidate) {
  throw new Error(`Unknown candidate ${candidateName}. Choose: ${Object.keys(candidates).join(', ')}.`);
}

const memoryBeforeImport = memorySnapshot();
const importStartedAt = performance.now();
// Force the browser build so this measures ONNX Runtime Web rather than the
// native Node execution provider selected by conditional package exports.
const browserBuild = pathToFileURL(resolve(here, 'node_modules/@huggingface/transformers/dist/transformers.web.js'));
const { env, pipeline } = await import(browserBuild.href);
const importMs = performance.now() - importStartedAt;
env.cacheDir = resolve(here, '.cache');
env.allowRemoteModels = true;
env.allowLocalModels = false;

const progress = new Map();
const loadStartedAt = performance.now();
const extractor = await pipeline('feature-extraction', candidate.id, {
  device: 'cpu',
  dtype: candidate.dtype,
  revision: candidate.revision,
  progress_callback: (event) => {
    if (verbose) console.error(JSON.stringify(event));
    if (event?.file && typeof event.loaded === 'number') {
      progress.set(event.file, Math.max(progress.get(event.file) ?? 0, event.loaded));
    }
  },
});
const loadMs = performance.now() - loadStartedAt;
const memoryAfterLoad = memorySnapshot();

const catalog = readJson(resolve(repositoryRoot, 'benchmarks/corpus/catalog.json'));
const cases = readJson(resolve(repositoryRoot, 'benchmarks/cases.json')).filter(({ kind }) => kind === 'relevance');
const documents = catalog.map((entry) => ({
  path: entry.path,
  text: `Title: ${basename(entry.path)}\nTags: ${entry.tags.join(', ')}\n\n${readFileSync(resolve(repositoryRoot, 'benchmarks/corpus', entry.file), 'utf8')}`,
}));

const documentStartedAt = performance.now();
const documentVectors = [];
const batchDurationsMs = [];
for (let offset = 0; offset < documents.length; offset += 8) {
  const batch = documents.slice(offset, offset + 8);
  const batchStartedAt = performance.now();
  const output = await extractor(batch.map(({ text }) => text), {
    normalize: true,
    pooling: candidate.pooling,
  });
  documentVectors.push(...output.tolist());
  batchDurationsMs.push(performance.now() - batchStartedAt);
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
}
const documentEmbeddingMs = performance.now() - documentStartedAt;

const caseResults = [];
const queryDurationsMs = [];
for (const testCase of cases) {
  const queryStartedAt = performance.now();
  const output = await extractor(`${candidate.queryPrefix}${testCase.query}`, {
    normalize: true,
    pooling: candidate.pooling,
  });
  queryDurationsMs.push(performance.now() - queryStartedAt);
  const [queryVector] = output.tolist();
  const ranked = documents
    .map((document, index) => ({
      path: document.path,
      score: dot(queryVector, documentVectors[index]),
    }))
    .sort((left, right) => right.score - left.score);
  caseResults.push({
    id: testCase.id,
    ...metrics(ranked.map(({ path }) => path), new Set(testCase.relevant)),
    top3: ranked.slice(0, 3),
  });
}

if (global.gc) global.gc();
const memoryAfterInference = memorySnapshot();
const packageMetadata = readJson(resolve(here, 'node_modules/@huggingface/transformers/package.json'));

const result = {
  candidate: candidateName,
  configuration: candidate,
  corpus: {
    documents: documents.length,
    queries: cases.length,
    meanCharacters: Math.round(documents.reduce((sum, { text }) => sum + text.length, 0) / documents.length),
  },
  environment: {
    architecture: arch(),
    node: process.version,
    os: `${platform()} ${release()}`,
    totalMemoryBytes: totalmem(),
    transformersJs: packageMetadata.version,
  },
  memoryBytes: {
    afterInference: memoryAfterInference,
    afterLoad: memoryAfterLoad,
    beforeImport: memoryBeforeImport,
    loadRssDelta: memoryAfterLoad.rss - memoryBeforeImport.rss,
    totalRssDelta: memoryAfterInference.rss - memoryBeforeImport.rss,
  },
  quality: {
    cases: caseResults,
    macro: average(caseResults),
  },
  run: runLabel,
  timingMs: {
    documentBatch: summarize(batchDurationsMs),
    documentEmbeddingTotal: documentEmbeddingMs,
    import: importMs,
    modelLoad: loadMs,
    query: summarize(queryDurationsMs),
  },
  transferredModelBytesObserved: [...progress.values()].reduce((sum, bytes) => sum + bytes, 0),
};

console.log(JSON.stringify(result, null, 2));
await extractor.dispose();

function readArgument(name) {
  const argument = process.argv.find((value) => value.startsWith(`${name}=`));
  return argument?.slice(name.length + 1);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function basename(path) {
  const parts = path.split('/');
  return (parts[parts.length - 1] ?? path).replace(/\.md$/u, '');
}

function dot(left, right) {
  return left.reduce((sum, value, index) => sum + value * (right[index] ?? 0), 0);
}

function metrics(ranked, relevant) {
  const top10 = ranked.slice(0, 10);
  const found = top10.filter((path) => relevant.has(path)).length;
  const first = ranked.findIndex((path) => relevant.has(path));
  return {
    mrr: first < 0 ? 0 : 1 / (first + 1),
    precisionAt10: found / 10,
    recallAt10: found / relevant.size,
  };
}

function average(results) {
  return {
    mrr: mean(results.map(({ mrr }) => mrr)),
    precisionAt10: mean(results.map(({ precisionAt10 }) => precisionAt10)),
    recallAt10: mean(results.map(({ recallAt10 }) => recallAt10)),
  };
}

function summarize(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    count: values.length,
    max: Math.max(...values),
    mean: mean(values),
    median: percentile(sorted, 0.5),
    min: Math.min(...values),
    p95: percentile(sorted, 0.95),
  };
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
}

function percentile(sorted, fraction) {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
}

function memorySnapshot() {
  const { external, heapUsed, rss } = process.memoryUsage();
  return { external, heapUsed, rss };
}
