import { requestUrl } from 'obsidian';

import type { EmbeddingProvider } from './semantic-index';

interface OllamaEmbedResponse {
  embeddings?: unknown;
}

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly id: string;

  constructor(
    private readonly endpoint: string,
    private readonly model: string,
  ) {
    this.id = `ollama:${normalizeEndpoint(endpoint)}:${model}`;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const response = await requestUrl({
      body: JSON.stringify({ input: texts, model: this.model, truncate: true }),
      contentType: 'application/json',
      method: 'POST',
      throw: false,
      url: normalizeEndpoint(this.endpoint),
    });

    if (response.status < 200 || response.status >= 300) {
      const detail = response.text.trim().slice(0, 180);
      throw new Error(`Ollama returned HTTP ${response.status}${detail ? `: ${detail}` : '.'}`);
    }

    const body = response.json as OllamaEmbedResponse;
    if (!Array.isArray(body.embeddings)) throw new Error('Ollama response did not contain embeddings.');
    const vectors = body.embeddings.map(toNumberVector);
    if (vectors.some((vector) => vector === null)) throw new Error('Ollama returned a malformed embedding vector.');
    return vectors as number[][];
  }
}

function normalizeEndpoint(endpoint: string): string {
  const trimmed = endpoint.trim().replace(/\/+$/u, '');
  return trimmed.endsWith('/api/embed') ? trimmed : `${trimmed}/api/embed`;
}

function toNumberVector(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'number' || !Number.isFinite(item))) {
    return null;
  }
  return value as number[];
}
