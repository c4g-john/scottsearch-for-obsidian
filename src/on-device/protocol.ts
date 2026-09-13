import type { EmbeddingPurpose } from '../semantic-index';

export interface InitializeWorkerRequest {
  id: number;
  kind: 'initialize';
  model: ArrayBuffer;
  tokenizerJson: string;
}

export interface EmbedWorkerRequest {
  id: number;
  kind: 'embed';
  purpose: EmbeddingPurpose;
  texts: string[];
}

export interface DisposeWorkerRequest {
  id: number;
  kind: 'dispose';
}

export type OnDeviceWorkerRequest = DisposeWorkerRequest | EmbedWorkerRequest | InitializeWorkerRequest;

export interface ReadyWorkerResponse {
  id: number;
  kind: 'ready';
  dimensions: number;
  modelRevision: string;
  runtimeVersion: string;
  workerInitializationMs: number;
}

export interface EmbeddingsWorkerResponse {
  id: number;
  kind: 'embeddings';
  vectors: Float32Array[];
}

export interface DisposedWorkerResponse {
  id: number;
  kind: 'disposed';
}

export interface ErrorWorkerResponse {
  id: number;
  kind: 'error';
  message: string;
}

export type OnDeviceWorkerResponse =
  | DisposedWorkerResponse
  | EmbeddingsWorkerResponse
  | ErrorWorkerResponse
  | ReadyWorkerResponse;
