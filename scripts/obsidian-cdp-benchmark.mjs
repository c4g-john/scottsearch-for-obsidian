const port = Number(process.argv[2] ?? 9223);
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const target = targets.find(({ url }) => url === 'app://obsidian.md/index.html');
if (!target?.webSocketDebuggerUrl) throw new Error('The isolated Obsidian vault target is not available.');

const client = await createCdpClient(target.webSocketDebuggerUrl);
await client.send('Runtime.enable');
await evaluate(`(() => {
  const state = { last: performance.now(), maxGapMs: 0, samples: 0, gapsOver100Ms: 0 };
  const timer = setInterval(() => {
    const now = performance.now();
    const gap = now - state.last;
    state.last = now;
    state.maxGapMs = Math.max(state.maxGapMs, gap);
    state.samples += 1;
    if (gap > 100) state.gapsOver100Ms += 1;
  }, 16);
  window.__scottSearchBenchmarkMonitor = { state, timer };
  return true;
})()`);

const observedAtMs = performance.now();
let peakRendererHeapBytes = 0;
let initialReady;
for (let attempt = 0; attempt < 480; attempt += 1) {
  const snapshot = await pluginSnapshot();
  peakRendererHeapBytes = Math.max(peakRendererHeapBytes, snapshot.rendererHeapBytes ?? 0);
  if (snapshot.phase === 'ready' && snapshot.indexedFiles === 1_000) {
    initialReady = snapshot;
    break;
  }
  await delay(250);
}
if (!initialReady) throw new Error('Initial Obsidian indexing did not become ready within two minutes.');
const initialReadyObservedMs = performance.now() - observedAtMs;

const queryTiming = await evaluate(`(async () => {
  const plugin = app.plugins.plugins.scottsearch;
  const provider = plugin.onDeviceProvider;
  if (!provider) throw new Error('On-device provider is not loaded.');
  const values = [];
  for (let index = 0; index < 25; index += 1) {
    const startedAt = performance.now();
    await provider.embed(['reducing coordination overhead'], 'query');
    values.push(performance.now() - startedAt);
  }
  return values;
})()`, true);

const cancellation = await evaluate(`(async () => {
  const plugin = app.plugins.plugins.scottsearch;
  await plugin.clearEmbeddingCache();
  plugin.settings.semanticEnabled = true;
  await plugin.savePluginData();
  const rebuilding = plugin.rebuildSemanticIndex();
  await new Promise((resolve) => setTimeout(resolve, 250));
  const startedAt = performance.now();
  await plugin.semanticToggleChanged(false);
  const cancelReturnedMs = performance.now() - startedAt;
  await rebuilding;
  return {
    cancelReturnedMs,
    phase: plugin.status.phase,
    providerDisposed: plugin.onDeviceProvider === undefined,
    semanticFiles: plugin.semanticIndex.size,
  };
})()`, true);

const warmStartedAt = performance.now();
const warm = await evaluate(`(async () => {
  const plugin = app.plugins.plugins.scottsearch;
  plugin.settings.semanticEnabled = true;
  await plugin.savePluginData();
  await plugin.semanticToggleChanged(true);
  return {
    diagnostics: plugin.onDeviceProvider?.getDiagnostics() ?? null,
    status: plugin.status,
  };
})()`, true);
const warmReindexMs = performance.now() - warmStartedAt;

const finalSnapshot = await pluginSnapshot();
peakRendererHeapBytes = Math.max(peakRendererHeapBytes, finalSnapshot.rendererHeapBytes ?? 0);
const responsiveness = await evaluate(`(() => {
  const monitor = window.__scottSearchBenchmarkMonitor;
  clearInterval(monitor.timer);
  return monitor.state;
})()`);

console.log(JSON.stringify({
  cancellation,
  environment: {
    appVersion: await evaluate('app.getVersion()'),
    platform: process.platform,
    rendererUserAgent: await evaluate('navigator.userAgent'),
  },
  finalSnapshot,
  initial: {
    readyObservedAfterHarnessAttachedMs: initialReadyObservedMs,
    snapshot: initialReady,
  },
  memory: { peakRendererHeapBytes },
  queryTimingMs: summarize(queryTiming),
  responsiveness,
  warm: { ...warm, totalReindexMs: warmReindexMs },
}, null, 2));
client.close();

async function pluginSnapshot() {
  return await evaluate(`(() => {
    const plugin = app.plugins.plugins.scottsearch;
    if (!plugin) return { loaded: false, rendererHeapBytes: performance.memory?.usedJSHeapSize ?? null };
    return {
      diagnostics: plugin.onDeviceProvider?.getDiagnostics() ?? null,
      indexedFiles: plugin.status.indexedFiles,
      lastError: plugin.status.lastError ?? null,
      loaded: true,
      phase: plugin.status.phase,
      rendererHeapBytes: performance.memory?.usedJSHeapSize ?? null,
      semanticFiles: plugin.status.semanticFiles,
      totalFiles: plugin.status.totalFiles,
    };
  })()`);
}

async function evaluate(expression, awaitPromise = false) {
  const response = await client.send('Runtime.evaluate', {
    awaitPromise,
    expression,
    returnByValue: true,
    userGesture: true,
  });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
  }
  return response.result.value;
}

async function createCdpClient(url) {
  const socket = new WebSocket(url);
  await new Promise((resolvePromise, reject) => {
    socket.addEventListener('open', resolvePromise, { once: true });
    socket.addEventListener('error', () => reject(new Error('Unable to connect to Obsidian CDP.')), { once: true });
  });
  let nextId = 1;
  const pending = new Map();
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(String(data));
    if (!message.id) return;
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  return {
    close: () => socket.close(),
    send(method, params = {}) {
      const id = nextId;
      nextId += 1;
      return new Promise((resolvePromise, reject) => {
        pending.set(id, { reject, resolve: resolvePromise });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
  };
}

function summarize(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    count: values.length,
    max: Math.max(...values),
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    median: percentile(sorted, 0.5),
    min: Math.min(...values),
    p95: percentile(sorted, 0.95),
  };
}

function percentile(sorted, fraction) {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
}

function delay(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}
