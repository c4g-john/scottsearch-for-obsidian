import { describe, expect, it } from 'vitest';

import type { VerifiedModelAssetManager } from '../src/model-assets/verified-model-manager';
import { meanAndNormalize, readClsVectors } from '../src/on-device/embedding-core';
import { OnDeviceEmbeddingProvider } from '../src/on-device/provider';
import type { OnDeviceWorkerRequest, OnDeviceWorkerResponse } from '../src/on-device/protocol';
import {
  ON_DEVICE_EMBEDDING_DIMENSIONS,
  ON_DEVICE_MODEL_REVISION,
  ON_DEVICE_PROVIDER_ID,
  ON_DEVICE_QUERY_PREFIX,
  ON_DEVICE_RUNTIME_VERSION,
} from '../src/on-device/runtime-metadata';

const encoder = new TextEncoder();

describe('on-device embedding math', () => {
  it('locks the retrieval query prefix and cache-significant provider schema', () => {
    expect(ON_DEVICE_QUERY_PREFIX).toBe('Represent this sentence for searching relevant passages: ');
    expect(ON_DEVICE_PROVIDER_ID).toContain(ON_DEVICE_MODEL_REVISION);
    expect(ON_DEVICE_PROVIDER_ID).toContain('cls-384:l2-normalized:query-prefix-v1');
  });

  it('extracts the CLS row from each 384-dimensional hidden state', () => {
    const data = new Float32Array(2 * 3 * ON_DEVICE_EMBEDDING_DIMENSIONS);
    data[0] = 2;
    data[ON_DEVICE_EMBEDDING_DIMENSIONS] = 99;
    data[3 * ON_DEVICE_EMBEDDING_DIMENSIONS + 1] = 4;

    const vectors = readClsVectors(data, [2, 3, ON_DEVICE_EMBEDDING_DIMENSIONS]);

    expect(vectors).toHaveLength(2);
    expect(vectors[0]?.[0]).toBe(2);
    expect(vectors[0]?.[ON_DEVICE_EMBEDDING_DIMENSIONS]).toBeUndefined();
    expect(vectors[1]?.[1]).toBe(4);
  });

  it('normalizes one chunk and averages multiple normalized chunks', () => {
    const horizontal = new Float32Array(ON_DEVICE_EMBEDDING_DIMENSIONS);
    horizontal[0] = 2;
    const vertical = new Float32Array(ON_DEVICE_EMBEDDING_DIMENSIONS);
    vertical[1] = 5;

    const one = meanAndNormalize([horizontal]);
    const mean = meanAndNormalize([horizontal, vertical]);

    expect(one[0]).toBeCloseTo(1);
    expect(mean[0]).toBeCloseTo(Math.SQRT1_2);
    expect(mean[1]).toBeCloseTo(Math.SQRT1_2);
    expect(vectorMagnitude(mean)).toBeCloseTo(1);
  });

  it('rejects wrong dimensions and non-normalizable output', () => {
    expect(() => readClsVectors(new Float32Array(2), [1, 1, 2])).toThrow('Unexpected');
    expect(() => meanAndNormalize([new Float32Array(ON_DEVICE_EMBEDDING_DIMENSIONS)])).toThrow('invalid chunk');
  });
});

describe('OnDeviceEmbeddingProvider', () => {
  it('loads verified bytes lazily, confirms metadata, and keeps purpose on worker messages', async () => {
    const manager = new FakeModelManager();
    const worker = new FakeWorker();
    const provider = new OnDeviceEmbeddingProvider(asManager(manager), { workerFactory: () => worker });

    expect(manager.readCount).toBe(0);
    expect(provider.id).toBe(ON_DEVICE_PROVIDER_ID);

    const vectors = await provider.embed(['coordination without meetings'], 'query');

    expect(manager.readCount).toBe(1);
    expect(worker.messages.map(({ kind }) => kind)).toEqual(['initialize', 'embed']);
    expect(worker.messages[1]).toMatchObject({ kind: 'embed', purpose: 'query' });
    expect(vectors).toHaveLength(1);
    expect(vectors[0]).toHaveLength(ON_DEVICE_EMBEDDING_DIMENSIONS);
    const diagnostics = provider.getDiagnostics();
    expect(diagnostics).toMatchObject({
      documentCalls: 0,
      queryCalls: 1,
      queryTexts: 1,
    });
    expect(typeof diagnostics.workerInitializationMs).toBe('number');
    provider.dispose();
    expect(worker.terminated).toBe(true);
  });

  it('terminates the worker and rejects pending inference when cancelled', async () => {
    const worker = new FakeWorker(true);
    const provider = new OnDeviceEmbeddingProvider(asManager(new FakeModelManager()), { workerFactory: () => worker });
    const controller = new AbortController();
    const request = provider.embed(['long note'], 'document', controller.signal);
    await until(() => worker.messages.some(({ kind }) => kind === 'embed'));

    controller.abort();

    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    expect(worker.terminated).toBe(true);
    expect(provider.isDisposed).toBe(true);
  });

  it('fails closed when worker metadata does not match the reviewed build', async () => {
    const worker = new FakeWorker(false, 'wrong-revision');
    const provider = new OnDeviceEmbeddingProvider(asManager(new FakeModelManager()), { workerFactory: () => worker });

    await expect(provider.embed(['note'])).rejects.toThrow('reviewed model configuration');
    expect(worker.terminated).toBe(true);
  });
});

class FakeModelManager {
  readCount = 0;

  readVerifiedArtifacts(): Promise<ReadonlyMap<string, ArrayBuffer>> {
    this.readCount += 1;
    return Promise.resolve(new Map([
      ['onnx/model_int8.onnx', encoder.encode('model').buffer],
      ['tokenizer.json', encoder.encode('{}').buffer],
    ]));
  }
}

class FakeWorker {
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessage: ((event: MessageEvent<OnDeviceWorkerResponse>) => void) | null = null;
  readonly messages: OnDeviceWorkerRequest[] = [];
  terminated = false;

  constructor(
    private readonly holdEmbed = false,
    private readonly modelRevision = ON_DEVICE_MODEL_REVISION,
  ) {}

  postMessage(message: OnDeviceWorkerRequest): void {
    this.messages.push(message);
    if (message.kind === 'initialize') {
      queueMicrotask(() => this.respond({
        dimensions: ON_DEVICE_EMBEDDING_DIMENSIONS,
        id: message.id,
        kind: 'ready',
        modelRevision: this.modelRevision,
        runtimeVersion: ON_DEVICE_RUNTIME_VERSION,
        workerInitializationMs: 12,
      }));
    } else if (message.kind === 'embed' && !this.holdEmbed) {
      const vectors = message.texts.map(() => {
        const vector = new Float32Array(ON_DEVICE_EMBEDDING_DIMENSIONS);
        vector[0] = 1;
        return vector;
      });
      queueMicrotask(() => this.respond({ id: message.id, kind: 'embeddings', vectors }));
    }
  }

  terminate(): void {
    this.terminated = true;
  }

  private respond(response: OnDeviceWorkerResponse): void {
    this.onmessage?.({ data: response } as MessageEvent<OnDeviceWorkerResponse>);
  }
}

function asManager(manager: FakeModelManager): VerifiedModelAssetManager {
  return manager as unknown as VerifiedModelAssetManager;
}

function vectorMagnitude(vector: Float32Array): number {
  return Math.sqrt([...vector].reduce((sum, value) => sum + value * value, 0));
}

async function until(condition: () => boolean): Promise<void> {
  for (let attempts = 0; attempts < 20; attempts += 1) {
    if (condition()) return;
    await Promise.resolve();
  }
  throw new Error('Timed out waiting for fake worker request.');
}
