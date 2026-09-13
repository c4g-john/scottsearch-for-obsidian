import workerSource from 'scottsearch:on-device-worker-source';

import type { VerifiedModelAssetManager } from '../model-assets/verified-model-manager';
import type { EmbeddingProvider, EmbeddingPurpose } from '../semantic-index';
import type {
  OnDeviceWorkerRequest,
  OnDeviceWorkerResponse,
} from './protocol';
import {
  ON_DEVICE_EMBEDDING_DIMENSIONS,
  ON_DEVICE_MODEL_REVISION,
  ON_DEVICE_PROVIDER_ID,
  ON_DEVICE_RUNTIME_VERSION,
} from './runtime-metadata';

interface WorkerLike {
  onerror: ((event: ErrorEvent) => void) | null;
  onmessage: ((event: MessageEvent<OnDeviceWorkerResponse>) => void) | null;
  postMessage(message: OnDeviceWorkerRequest, transfer?: Transferable[]): void;
  terminate(): void;
}

interface PendingRequest {
  reject: (error: Error) => void;
  resolve: (response: OnDeviceWorkerResponse) => void;
}

export interface OnDeviceEmbeddingProviderOptions {
  workerFactory?: () => WorkerLike;
}

export interface OnDeviceEmbeddingDiagnostics {
  documentCalls: number;
  documentTexts: number;
  initializationMs?: number;
  queryCalls: number;
  queryTexts: number;
  roundTripDurationsMs: number[];
  workerInitializationMs?: number;
}

export class OnDeviceEmbeddingProvider implements EmbeddingProvider {
  readonly id = ON_DEVICE_PROVIDER_ID;

  private disposed = false;
  private nextRequestId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private readyPromise?: Promise<void>;
  private worker?: WorkerLike;
  private readonly diagnostics: OnDeviceEmbeddingDiagnostics = {
    documentCalls: 0,
    documentTexts: 0,
    queryCalls: 0,
    queryTexts: 0,
    roundTripDurationsMs: [],
  };

  constructor(
    private readonly modelAssets: VerifiedModelAssetManager,
    private readonly options: OnDeviceEmbeddingProviderOptions = {},
  ) {}

  get isDisposed(): boolean {
    return this.disposed;
  }

  getDiagnostics(): OnDeviceEmbeddingDiagnostics {
    return { ...this.diagnostics, roundTripDurationsMs: [...this.diagnostics.roundTripDurationsMs] };
  }

  async embed(
    texts: string[],
    purpose: EmbeddingPurpose = 'document',
    signal?: AbortSignal,
  ): Promise<number[][]> {
    if (texts.length === 0) return [];
    if (signal?.aborted) throw cancellationError();
    const cancel = () => this.dispose(cancellationError());
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      await this.ensureReady();
      if (signal?.aborted) throw cancellationError();
      const startedAt = performance.now();
      const response = await this.call((id) => ({ id, kind: 'embed', purpose, texts }));
      if (response.kind !== 'embeddings') throw new Error('The on-device worker returned an unexpected response.');
      if (response.vectors.length !== texts.length) {
        throw new Error('The on-device worker returned an incomplete embedding batch.');
      }
      const vectors = response.vectors.map((vector) => {
        if (
          !(vector instanceof Float32Array)
          || vector.length !== ON_DEVICE_EMBEDDING_DIMENSIONS
          || vector.some((value) => !Number.isFinite(value))
        ) throw new Error('The on-device worker returned an invalid embedding vector.');
        return Array.from(vector);
      });
      this.diagnostics.roundTripDurationsMs.push(performance.now() - startedAt);
      if (this.diagnostics.roundTripDurationsMs.length > 512) {
        this.diagnostics.roundTripDurationsMs.shift();
      }
      if (purpose === 'query') {
        this.diagnostics.queryCalls += 1;
        this.diagnostics.queryTexts += texts.length;
      } else {
        this.diagnostics.documentCalls += 1;
        this.diagnostics.documentTexts += texts.length;
      }
      return vectors;
    } finally {
      signal?.removeEventListener('abort', cancel);
    }
  }

  dispose(reason = new Error('The on-device embedding worker was disposed.')): void {
    if (this.disposed) return;
    this.disposed = true;
    this.worker?.terminate();
    this.worker = undefined;
    for (const pending of this.pending.values()) pending.reject(reason);
    this.pending.clear();
  }

  private ensureReady(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('The on-device embedding worker is no longer available.'));
    this.readyPromise ??= this.initialize().catch((error: unknown) => {
      const readable = error instanceof Error ? error : new Error(String(error));
      this.dispose(readable);
      throw readable;
    });
    return this.readyPromise;
  }

  private async initialize(): Promise<void> {
    const initializationStartedAt = performance.now();
    const artifacts = await this.modelAssets.readVerifiedArtifacts();
    if (this.disposed) throw cancellationError();
    const model = artifacts.get('onnx/model_int8.onnx');
    const tokenizer = artifacts.get('tokenizer.json');
    if (!model || !tokenizer) throw new Error('The verified model installation is incomplete.');

    this.worker = this.options.workerFactory?.() ?? createWorker();
    this.worker.onmessage = (event) => this.receive(event.data);
    this.worker.onerror = (event) => {
      this.dispose(new Error(event.message || 'The on-device worker stopped unexpectedly.'));
    };

    const response = await this.call(
      (id) => ({
        id,
        kind: 'initialize',
        model,
        tokenizerJson: new TextDecoder().decode(tokenizer),
      }),
      [model],
    );
    if (
      response.kind !== 'ready'
      || response.dimensions !== ON_DEVICE_EMBEDDING_DIMENSIONS
      || response.modelRevision !== ON_DEVICE_MODEL_REVISION
      || response.runtimeVersion !== ON_DEVICE_RUNTIME_VERSION
      || !Number.isFinite(response.workerInitializationMs)
    ) throw new Error('The on-device worker did not confirm the reviewed model configuration.');
    this.diagnostics.initializationMs = performance.now() - initializationStartedAt;
    this.diagnostics.workerInitializationMs = response.workerInitializationMs;
  }

  private call(
    createRequest: (id: number) => OnDeviceWorkerRequest,
    transfer: Transferable[] = [],
  ): Promise<OnDeviceWorkerResponse> {
    if (this.disposed || !this.worker) {
      return Promise.reject(new Error('The on-device embedding worker is not available.'));
    }
    const id = this.nextRequestId;
    this.nextRequestId += 1;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { reject, resolve });
      try {
        this.worker?.postMessage(createRequest(id), transfer);
      } catch (error) {
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private receive(response: OnDeviceWorkerResponse): void {
    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.pending.delete(response.id);
    if (response.kind === 'error') pending.reject(new Error(response.message));
    else pending.resolve(response);
  }
}

function createWorker(): WorkerLike {
  const url = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
  try {
    return new Worker(url, { name: 'ScottSearch on-device embeddings' });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function cancellationError(): Error {
  const error = new Error('On-device embedding work was cancelled.');
  error.name = 'AbortError';
  return error;
}
