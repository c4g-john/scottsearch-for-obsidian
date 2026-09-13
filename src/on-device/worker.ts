import * as ort from 'onnxruntime-web/wasm';

import runtimeGzipBase64 from 'scottsearch:ort-wasm-gzip-base64';

import type { EmbeddingPurpose } from '../semantic-index';
import { BertWordPieceTokenizer } from './bert-tokenizer';
import { meanAndNormalize, readClsVectors } from './embedding-core';
import type {
  OnDeviceWorkerRequest,
  OnDeviceWorkerResponse,
} from './protocol';
import {
  ON_DEVICE_EMBEDDING_DIMENSIONS,
  ON_DEVICE_INFERENCE_BATCH_SIZE,
  ON_DEVICE_MAX_DOCUMENT_CHUNKS,
  ON_DEVICE_MODEL_REVISION,
  ON_DEVICE_QUERY_PREFIX,
  ON_DEVICE_RUNTIME_VERSION,
  ON_DEVICE_RUNTIME_WASM_BYTES,
} from './runtime-metadata';

interface ScottSearchWorkerScope {
  close(): void;
  onmessage: ((event: MessageEvent<OnDeviceWorkerRequest>) => void) | null;
  postMessage(message: OnDeviceWorkerResponse, transfer?: Transferable[]): void;
}

const scope = globalThis as unknown as ScottSearchWorkerScope;
let session: ort.InferenceSession | undefined;
let tokenizer: BertWordPieceTokenizer | undefined;
let operationQueue = Promise.resolve();

scope.onmessage = (event) => {
  const request = event.data;
  operationQueue = operationQueue.then(async () => {
    try {
      await handleRequest(request);
    } catch (error) {
      post({ id: request.id, kind: 'error', message: readableError(error) });
    }
  });
};

async function handleRequest(request: OnDeviceWorkerRequest): Promise<void> {
  if (request.kind === 'initialize') {
    if (session) throw new Error('The on-device worker is already initialized.');
    const initializationStartedAt = performance.now();
    const wasmBinary = await decompressRuntime();
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    ort.env.wasm.wasmBinary = wasmBinary;
    tokenizer = new BertWordPieceTokenizer(request.tokenizerJson);
    if (tokenizer.maximumSequenceLength !== 512) {
      throw new Error('The reviewed model tokenizer has an unexpected maximum sequence length.');
    }
    session = await ort.InferenceSession.create(request.model, {
      executionMode: 'sequential',
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });
    requireModelInterface(session);
    post({
      dimensions: ON_DEVICE_EMBEDDING_DIMENSIONS,
      id: request.id,
      kind: 'ready',
      modelRevision: ON_DEVICE_MODEL_REVISION,
      runtimeVersion: ON_DEVICE_RUNTIME_VERSION,
      workerInitializationMs: performance.now() - initializationStartedAt,
    });
    return;
  }

  if (request.kind === 'embed') {
    const vectors = await embedTexts(request.texts, request.purpose);
    post(
      { id: request.id, kind: 'embeddings', vectors },
      vectors.map((vector) => vector.buffer),
    );
    return;
  }

  if (session) await session.release();
  session = undefined;
  tokenizer = undefined;
  post({ id: request.id, kind: 'disposed' });
  scope.close();
}

async function embedTexts(
  texts: string[],
  purpose: EmbeddingPurpose,
): Promise<Float32Array[]> {
  if (!session || !tokenizer) throw new Error('The on-device model is not ready.');
  if (texts.length === 0) return [];

  const sequences: number[][] = [];
  const owners: number[] = [];
  for (let owner = 0; owner < texts.length; owner += 1) {
    const text = texts[owner] ?? '';
    const chunks = purpose === 'query'
      ? [tokenizer.encode(`${ON_DEVICE_QUERY_PREFIX}${text}`)]
      : tokenizer.encodeChunks(text, ON_DEVICE_MAX_DOCUMENT_CHUNKS);
    for (const chunk of chunks) {
      owners.push(owner);
      sequences.push(chunk);
    }
  }

  const grouped = Array.from({ length: texts.length }, () => [] as Float32Array[]);
  for (let offset = 0; offset < sequences.length; offset += ON_DEVICE_INFERENCE_BATCH_SIZE) {
    const sequenceBatch = sequences.slice(offset, offset + ON_DEVICE_INFERENCE_BATCH_SIZE);
    const encoded = tokenizer.padSequences(sequenceBatch);
    const feeds: Record<string, ort.Tensor> = {
      attention_mask: new ort.Tensor('int64', encoded.attentionMask, encoded.dimensions),
      input_ids: new ort.Tensor('int64', encoded.inputIds, encoded.dimensions),
      token_type_ids: new ort.Tensor('int64', encoded.tokenTypeIds, encoded.dimensions),
    };
    try {
      const output = await session.run(feeds);
      try {
        const hiddenState = output.last_hidden_state;
        if (!hiddenState || !(hiddenState.data instanceof Float32Array)) {
          throw new Error('The on-device model did not return its expected float32 hidden state.');
        }
        const vectors = readClsVectors(hiddenState.data, hiddenState.dims);
        for (let index = 0; index < vectors.length; index += 1) {
          const owner = owners[offset + index];
          const vector = vectors[index];
          if (owner === undefined || !vector) throw new Error('The on-device model returned an incomplete batch.');
          grouped[owner]?.push(vector);
        }
      } finally {
        for (const tensor of new Set(Object.values(output))) tensor.dispose();
      }
    } finally {
      for (const tensor of Object.values(feeds)) tensor.dispose();
    }
    await yieldToWorker();
  }
  return grouped.map(meanAndNormalize);
}

function requireModelInterface(value: ort.InferenceSession): void {
  const inputs = new Set(value.inputNames);
  const outputs = new Set(value.outputNames);
  for (const name of ['attention_mask', 'input_ids', 'token_type_ids']) {
    if (!inputs.has(name)) throw new Error(`The reviewed model is missing its ${name} input.`);
  }
  if (!outputs.has('last_hidden_state')) {
    throw new Error('The reviewed model is missing its last_hidden_state output.');
  }
}

async function decompressRuntime(): Promise<ArrayBuffer> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This Obsidian desktop version cannot unpack the experimental inference runtime.');
  }
  const compressed = Uint8Array.from(atob(runtimeGzipBase64), (character) => character.charCodeAt(0));
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'));
  const wasmBinary = await new Response(stream).arrayBuffer();
  if (wasmBinary.byteLength !== ON_DEVICE_RUNTIME_WASM_BYTES) {
    throw new Error('The bundled inference runtime has an unexpected size.');
  }
  return wasmBinary;
}

function post(message: OnDeviceWorkerResponse, transfer: Transferable[] = []): void {
  scope.postMessage(message, transfer);
}

function readableError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function yieldToWorker(): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, 0));
}
