import { env, pipeline } from '@huggingface/transformers';

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

const parameters = new URLSearchParams(location.search);
const candidateName = parameters.get('candidate') ?? 'arctic-xs';
const runLabel = parameters.get('run') ?? 'browser';
const candidate = candidates[candidateName];
const status = document.querySelector('#status');
const resultElement = document.querySelector('#result');

if (!candidate) throw new Error(`Unknown candidate: ${candidateName}`);

env.allowRemoteModels = true;
env.allowLocalModels = false;

run().catch((error) => {
  status.textContent = 'Benchmark failed.';
  resultElement.dataset.state = 'error';
  resultElement.textContent = JSON.stringify({
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  }, null, 2);
});

async function run() {
  const startedAt = performance.now();
  const memoryBeforeLoad = memorySnapshot();
  const progress = new Map();

  status.textContent = `Loading ${candidate.id}…`;
  const modelLoadStartedAt = performance.now();
  const extractor = await pipeline('feature-extraction', candidate.id, {
    device: 'wasm',
    dtype: candidate.dtype,
    revision: candidate.revision,
    progress_callback: (event) => {
      if (event?.file && typeof event.loaded === 'number') {
        progress.set(event.file, Math.max(progress.get(event.file) ?? 0, event.loaded));
      }
      if (event?.file && typeof event.progress === 'number') {
        status.textContent = `Loading ${event.file}: ${event.progress.toFixed(1)}%`;
      }
    },
  });
  const modelLoadMs = performance.now() - modelLoadStartedAt;
  const memoryAfterLoad = memorySnapshot();

  status.textContent = 'Loading the shared relevance corpus…';
  const [catalog, allCases] = await Promise.all([
    fetchJson('/benchmarks/corpus/catalog.json'),
    fetchJson('/benchmarks/cases.json'),
  ]);
  const cases = allCases.filter(({ kind }) => kind === 'relevance');
  const documents = await Promise.all(catalog.map(async (entry) => ({
    path: entry.path,
    text: `Title: ${basename(entry.path)}\nTags: ${entry.tags.join(', ')}\n\n${await fetchText(`/benchmarks/corpus/${encodePath(entry.file)}`)}`,
  })));

  status.textContent = `Embedding ${documents.length} notes…`;
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
    await new Promise(requestAnimationFrame);
  }
  const documentEmbeddingMs = performance.now() - documentStartedAt;

  const caseResults = [];
  const queryDurationsMs = [];
  for (const [index, testCase] of cases.entries()) {
    status.textContent = `Running query ${index + 1} of ${cases.length}…`;
    const queryStartedAt = performance.now();
    const output = await extractor(`${candidate.queryPrefix}${testCase.query}`, {
      normalize: true,
      pooling: candidate.pooling,
    });
    queryDurationsMs.push(performance.now() - queryStartedAt);
    const [queryVector] = output.tolist();
    const ranked = documents
      .map((document, documentIndex) => ({
        path: document.path,
        score: dot(queryVector, documentVectors[documentIndex]),
      }))
      .sort((left, right) => right.score - left.score);
    caseResults.push({
      id: testCase.id,
      ...metrics(ranked.map(({ path }) => path), new Set(testCase.relevant)),
      top3: ranked.slice(0, 3),
    });
  }

  const memoryAfterInference = memorySnapshot();
  const result = {
    candidate: candidateName,
    configuration: candidate,
    corpus: {
      documents: documents.length,
      queries: cases.length,
      meanCharacters: Math.round(documents.reduce((sum, { text }) => sum + text.length, 0) / documents.length),
    },
    environment: {
      hardwareConcurrency: navigator.hardwareConcurrency,
      platform: navigator.platform,
      userAgent: navigator.userAgent,
    },
    memoryBytes: {
      afterInference: memoryAfterInference,
      afterLoad: memoryAfterLoad,
      beforeLoad: memoryBeforeLoad,
      loadJsHeapDelta: subtractMemory(memoryAfterLoad, memoryBeforeLoad),
      totalJsHeapDelta: subtractMemory(memoryAfterInference, memoryBeforeLoad),
    },
    quality: {
      cases: caseResults,
      macro: average(caseResults),
    },
    resources: performance.getEntriesByType('resource')
      .filter(({ name }) => /huggingface|onnx|ort-wasm/u.test(name))
      .map(({ name, transferSize, encodedBodySize, decodedBodySize, duration }) => ({
        name,
        transferSize,
        encodedBodySize,
        decodedBodySize,
        duration,
      })),
    run: runLabel,
    timingMs: {
      documentBatch: summarize(batchDurationsMs),
      documentEmbeddingTotal: documentEmbeddingMs,
      modelLoad: modelLoadMs,
      query: summarize(queryDurationsMs),
      total: performance.now() - startedAt,
    },
    transferredModelBytesObserved: [...progress.values()].reduce((sum, bytes) => sum + bytes, 0),
  };

  await extractor.dispose();
  status.textContent = 'Benchmark complete.';
  resultElement.dataset.state = 'complete';
  resultElement.textContent = JSON.stringify(result, null, 2);
}

async function fetchJson(path) {
  return JSON.parse(await fetchText(path));
}

async function fetchText(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Unable to load ${path}: HTTP ${response.status}`);
  return response.text();
}

function encodePath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

function basename(path) {
  const parts = path.split('/');
  return (parts.at(-1) ?? path).replace(/\.md$/u, '');
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
  const memory = performance.memory;
  return memory ? {
    jsHeapSizeLimit: memory.jsHeapSizeLimit,
    totalJsHeapSize: memory.totalJSHeapSize,
    usedJsHeapSize: memory.usedJSHeapSize,
  } : null;
}

function subtractMemory(after, before) {
  if (!after || !before) return null;
  return {
    totalJsHeapSize: after.totalJsHeapSize - before.totalJsHeapSize,
    usedJsHeapSize: after.usedJsHeapSize - before.usedJsHeapSize,
  };
}
