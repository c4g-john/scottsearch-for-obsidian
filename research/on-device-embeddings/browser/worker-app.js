const MODEL_REVISION = 'd8c86521100d3556476a063fc2342036d45c106f';
const RUNTIME_VERSION = 'onnxruntime-web@1.29.0';
const status = document.querySelector('#status');
const resultElement = document.querySelector('#result');
const runLabel = new URLSearchParams(location.search).get('run') ?? 'local';

run().catch((error) => {
  status.textContent = 'Benchmark failed.';
  resultElement.dataset.state = 'error';
  resultElement.textContent = JSON.stringify({
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  }, null, 2);
});

async function run() {
  const totalStartedAt = performance.now();
  const responsiveness = monitorResponsiveness();
  status.textContent = 'Reading the pinned local model fixture…';
  const [model, tokenizerJson, catalog, allCases] = await Promise.all([
    fetchBuffer('../dist/model/onnx/model_int8.onnx'),
    fetchText('../dist/model/tokenizer.json'),
    fetchJson('/benchmarks/corpus/catalog.json'),
    fetchJson('/benchmarks/cases.json'),
  ]);
  const cases = allCases.filter(({ kind }) => kind === 'relevance');
  const documents = await Promise.all(catalog.map(async (entry) => ({
    path: entry.path,
    text: `Title: ${basename(entry.path)}\nTags: ${entry.tags.join(', ')}\n\n${await fetchText(`/benchmarks/corpus/${encodePath(entry.file)}`)}`,
  })));

  status.textContent = 'Initializing the exact bundled worker…';
  const worker = new Worker('../dist/scottsearch-worker.js', { name: 'ScottSearch benchmark worker' });
  const client = createClient(worker);
  const loadStartedAt = performance.now();
  const ready = await client.call((id) => ({ id, kind: 'initialize', model, tokenizerJson }), [model]);
  const loadMs = performance.now() - loadStartedAt;
  if (ready.kind !== 'ready') throw new Error(`Unexpected ready response: ${ready.kind}`);

  status.textContent = `Indexing ${documents.length} relevance notes…`;
  const documentStartedAt = performance.now();
  const documentResult = await client.call((id) => ({
    id,
    kind: 'embed',
    purpose: 'document',
    texts: documents.map(({ text }) => text),
  }));
  if (documentResult.kind !== 'embeddings') throw new Error(`Unexpected embedding response: ${documentResult.kind}`);
  const documentEmbeddingMs = performance.now() - documentStartedAt;

  const queryDurations = [];
  const caseResults = [];
  for (const [index, testCase] of cases.entries()) {
    status.textContent = `Running query ${index + 1} of ${cases.length}…`;
    const queryStartedAt = performance.now();
    const response = await client.call((id) => ({ id, kind: 'embed', purpose: 'query', texts: [testCase.query] }));
    queryDurations.push(performance.now() - queryStartedAt);
    if (response.kind !== 'embeddings') throw new Error(`Unexpected query response: ${response.kind}`);
    const queryVector = response.vectors[0];
    const ranked = documents
      .map((document, index) => ({ path: document.path, score: dot(queryVector, documentResult.vectors[index]) }))
      .sort((left, right) => right.score - left.score);
    caseResults.push({
      id: testCase.id,
      ...metrics(ranked.map(({ path }) => path), new Set(testCase.relevant)),
      top3: ranked.slice(0, 3),
    });
  }

  status.textContent = 'Measuring a synthetic 1,000-note indexing run…';
  const thousandNotes = Array.from({ length: 1_000 }, (_, index) => {
    const source = documents[index % documents.length];
    return `${source.text}\nSynthetic benchmark copy ${index + 1}.`;
  });
  const thousandStartedAt = performance.now();
  for (let offset = 0; offset < thousandNotes.length; offset += 8) {
    const response = await client.call((id) => ({
      id,
      kind: 'embed',
      purpose: 'document',
      texts: thousandNotes.slice(offset, offset + 8),
    }));
    if (response.kind !== 'embeddings') throw new Error(`Unexpected indexing response: ${response.kind}`);
  }
  const thousandNoteIndexMs = performance.now() - thousandStartedAt;

  const memory = await memorySnapshot();
  const responsivenessResult = responsiveness.stop();
  const disposeResponse = await client.call((id) => ({ id, kind: 'dispose' }));
  if (disposeResponse.kind !== 'disposed') throw new Error(`Unexpected dispose response: ${disposeResponse.kind}`);

  const cancellation = await measureCancellation(tokenizerJson);
  const result = {
    cancellation,
    configuration: {
      dimensions: ready.dimensions,
      modelRevision: ready.modelRevision,
      runtimeVersion: ready.runtimeVersion,
      workerInitializationMs: ready.workerInitializationMs,
    },
    corpus: { documents: documents.length, queries: cases.length },
    environment: {
      hardwareConcurrency: navigator.hardwareConcurrency,
      platform: navigator.platform,
      userAgent: navigator.userAgent,
    },
    memory,
    quality: { cases: caseResults, macro: average(caseResults) },
    responsiveness: responsivenessResult,
    run: runLabel,
    timingMs: {
      documentEmbeddingTotal: documentEmbeddingMs,
      modelLoad: loadMs,
      query: summarize(queryDurations),
      thousandNoteIndex: thousandNoteIndexMs,
      total: performance.now() - totalStartedAt,
    },
  };
  if (ready.modelRevision !== MODEL_REVISION || ready.runtimeVersion !== RUNTIME_VERSION) {
    throw new Error('Worker metadata does not match the harness expectation.');
  }
  status.textContent = 'Benchmark complete.';
  resultElement.dataset.state = 'complete';
  resultElement.textContent = JSON.stringify(result, null, 2);
}

function createClient(worker) {
  let nextId = 1;
  const pending = new Map();
  worker.onmessage = ({ data }) => {
    const request = pending.get(data.id);
    if (!request) return;
    pending.delete(data.id);
    if (data.kind === 'error') request.reject(new Error(data.message));
    else request.resolve(data);
  };
  worker.onerror = ({ message }) => {
    for (const request of pending.values()) request.reject(new Error(message));
    pending.clear();
  };
  return {
    call(createMessage, transfer = []) {
      const id = nextId;
      nextId += 1;
      return new Promise((resolve, reject) => {
        pending.set(id, { reject, resolve });
        worker.postMessage(createMessage(id), transfer);
      });
    },
  };
}

async function measureCancellation(tokenizerJson) {
  const model = await fetchBuffer('../dist/model/onnx/model_int8.onnx');
  const worker = new Worker('../dist/scottsearch-worker.js', { name: 'ScottSearch cancellation benchmark' });
  const client = createClient(worker);
  await client.call((id) => ({ id, kind: 'initialize', model, tokenizerJson }), [model]);
  const longDocuments = Array.from({ length: 64 }, (_, index) => `Cancellation note ${index}. `.repeat(2_000));
  void client.call((id) => ({ id, kind: 'embed', purpose: 'document', texts: longDocuments })).catch(() => undefined);
  await new Promise((resolve) => setTimeout(resolve, 25));
  const startedAt = performance.now();
  worker.terminate();
  const terminateCallMs = performance.now() - startedAt;
  const recoveryStartedAt = performance.now();
  await new Promise((resolve) => setTimeout(resolve, 0));
  return {
    mainEventLoopRecoveryMs: performance.now() - recoveryStartedAt,
    terminateCallMs,
    workerTerminated: true,
  };
}

function monitorResponsiveness() {
  let last = performance.now();
  const gaps = [];
  const timer = setInterval(() => {
    const now = performance.now();
    gaps.push(now - last);
    last = now;
  }, 16);
  return {
    stop() {
      clearInterval(timer);
      return { maxTimerGapMs: Math.max(...gaps), samples: gaps.length, timerGapsOver100Ms: gaps.filter((gap) => gap > 100).length };
    },
  };
}

async function memorySnapshot() {
  if ('measureUserAgentSpecificMemory' in performance) {
    try { return await performance.measureUserAgentSpecificMemory(); } catch { /* Browser may require isolation. */ }
  }
  return performance.memory ? {
    jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
    totalJsHeapSize: performance.memory.totalJSHeapSize,
    usedJsHeapSize: performance.memory.usedJSHeapSize,
  } : null;
}

async function fetchBuffer(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Unable to load ${path}: HTTP ${response.status}`);
  return response.arrayBuffer();
}

async function fetchJson(path) { return JSON.parse(await fetchText(path)); }
async function fetchText(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Unable to load ${path}: HTTP ${response.status}`);
  return response.text();
}
function encodePath(path) { return path.split('/').map(encodeURIComponent).join('/'); }
function basename(path) { return (path.split('/').at(-1) ?? path).replace(/\.md$/u, ''); }
function dot(left, right) { return [...left].reduce((sum, value, index) => sum + value * (right?.[index] ?? 0), 0); }
function metrics(ranked, relevant) {
  const top10 = ranked.slice(0, 10);
  const found = top10.filter((path) => relevant.has(path)).length;
  const first = ranked.findIndex((path) => relevant.has(path));
  return { mrr: first < 0 ? 0 : 1 / (first + 1), precisionAt10: found / 10, recallAt10: found / relevant.size };
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
  return { count: values.length, max: Math.max(...values), mean: mean(values), median: percentile(sorted, .5), min: Math.min(...values), p95: percentile(sorted, .95) };
}
function mean(values) { return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1); }
function percentile(sorted, fraction) { return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0; }
