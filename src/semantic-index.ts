import type { SearchDocument } from './search-engine';

export type EmbeddingPurpose = 'document' | 'query';

export interface EmbeddingProvider {
  readonly id: string;
  embed(texts: string[], purpose?: EmbeddingPurpose, signal?: AbortSignal): Promise<number[][]>;
  dispose?(): void;
}

export interface SerializedEmbedding {
  mtime: number;
  providerId: string;
  size: number;
  vector: number[];
}

export type SerializedEmbeddingCache = Record<string, SerializedEmbedding>;

export interface SemanticProgress {
  completed: number;
  total: number;
}

interface CachedEmbedding extends SerializedEmbedding {
  vector: number[];
}

export class SemanticIndex {
  private readonly cache = new Map<string, CachedEmbedding>();

  get size(): number {
    return this.cache.size;
  }

  clear(): void {
    this.cache.clear();
  }

  remove(path: string): void {
    this.cache.delete(path);
  }

  load(serialized: SerializedEmbeddingCache): void {
    this.cache.clear();
    for (const [path, entry] of Object.entries(serialized)) {
      const vector = normalizeVector(entry.vector);
      if (vector) this.cache.set(path, { ...entry, vector });
    }
  }

  serialize(): SerializedEmbeddingCache {
    return Object.fromEntries(
      [...this.cache.entries()].map(([path, entry]) => [path, {
        mtime: entry.mtime,
        providerId: entry.providerId,
        size: entry.size,
        vector: entry.vector,
      }]),
    );
  }

  pathsNeedingUpdate(documents: SearchDocument[], providerId: string): string[] {
    return documents
      .filter((document) => {
        const cached = this.cache.get(document.path);
        if (
          cached
          && cached.size === undefined
          && cached.mtime === document.mtime
          && cached.providerId === providerId
        ) {
          cached.size = document.size;
          return false;
        }
        return cached?.mtime !== document.mtime
          || cached.size !== document.size
          || cached.providerId !== providerId;
      })
      .map((document) => document.path);
  }

  async update(
    documents: SearchDocument[],
    provider: EmbeddingProvider,
    batchSize: number,
    onProgress?: (progress: SemanticProgress) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    throwIfAborted(signal);
    const currentPaths = new Set(documents.map((document) => document.path));
    for (const path of this.cache.keys()) {
      if (!currentPaths.has(path)) this.cache.delete(path);
    }

    const pendingPaths = new Set(this.pathsNeedingUpdate(documents, provider.id));
    const pending = documents.filter((document) => pendingPaths.has(document.path));
    let completed = documents.length - pending.length;
    onProgress?.({ completed, total: documents.length });

    const safeBatchSize = Math.max(1, Math.floor(batchSize));
    for (let offset = 0; offset < pending.length; offset += safeBatchSize) {
      throwIfAborted(signal);
      const batch = pending.slice(offset, offset + safeBatchSize);
      const vectors = await provider.embed(batch.map(toEmbeddingText), 'document', signal);
      throwIfAborted(signal);
      if (vectors.length !== batch.length) {
        throw new Error(`Embedding provider returned ${vectors.length} vectors for ${batch.length} documents.`);
      }

      for (let index = 0; index < batch.length; index += 1) {
        const document = batch[index];
        const sourceVector = vectors[index];
        if (!document || !sourceVector) throw new Error('Embedding provider returned an incomplete batch.');
        const vector = normalizeVector(sourceVector);
        if (!vector) throw new Error(`Embedding provider returned an invalid vector for ${document.path}.`);
        this.cache.set(document.path, {
          mtime: document.mtime,
          providerId: provider.id,
          size: document.size,
          vector,
        });
      }

      completed += batch.length;
      onProgress?.({ completed, total: documents.length });
      await yieldToEventLoop();
    }
  }

  async score(queryText: string, provider: EmbeddingProvider, signal?: AbortSignal): Promise<Map<string, number>> {
    throwIfAborted(signal);
    const [sourceVector] = await provider.embed([queryText], 'query', signal);
    throwIfAborted(signal);
    const queryVector = sourceVector ? normalizeVector(sourceVector) : null;
    if (!queryVector) throw new Error('Embedding provider returned an invalid query vector.');

    const scores = new Map<string, number>();
    for (const [path, cached] of this.cache) {
      if (cached.providerId !== provider.id || cached.vector.length !== queryVector.length) continue;
      scores.set(path, Math.max(0, dot(queryVector, cached.vector)));
    }
    return scores;
  }
}

function toEmbeddingText(document: SearchDocument): string {
  const heading = `Title: ${document.basename}\nTags: ${document.tags.join(', ')}\n\n`;
  return `${heading}${document.content}`;
}

export function normalizeVector(vector: number[]): number[] | null {
  if (vector.length === 0 || vector.some((value) => !Number.isFinite(value))) return null;
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (magnitude === 0) return null;
  return vector.map((value) => value / magnitude);
}

export function cosineSimilarity(left: number[], right: number[]): number {
  const normalizedLeft = normalizeVector(left);
  const normalizedRight = normalizeVector(right);
  if (!normalizedLeft || !normalizedRight || normalizedLeft.length !== normalizedRight.length) return 0;
  return dot(normalizedLeft, normalizedRight);
}

function dot(left: number[], right: number[]): number {
  let value = 0;
  for (let index = 0; index < left.length; index += 1) {
    value += (left[index] ?? 0) * (right[index] ?? 0);
  }
  return value;
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, 0));
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error('Semantic indexing was cancelled.');
  error.name = 'AbortError';
  throw error;
}
