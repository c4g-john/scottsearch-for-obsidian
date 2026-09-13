import { describe, expect, it, vi } from 'vitest';

import { cosineSimilarity, SemanticIndex, type EmbeddingProvider } from '../src/semantic-index';
import type { SearchDocument } from '../src/search-engine';

function document(path: string, mtime: number): SearchDocument {
  return {
    basename: path.replace(/\.md$/u, ''),
    content: `Content for ${path}`,
    ctime: mtime,
    extension: 'md',
    mtime,
    path,
    tags: [],
  };
}

function provider(id = 'test:model'): EmbeddingProvider & { embed: ReturnType<typeof vi.fn> } {
  return {
    id,
    embed: vi.fn(async (texts: string[]) => texts.map((text) =>
      text.includes('alpha') || text.includes('Alpha') ? [1, 0] : [0, 1],
    )),
  };
}

describe('SemanticIndex', () => {
  it('embeds batches, reuses fresh cache entries, and removes deleted paths', async () => {
    const index = new SemanticIndex();
    const embedder = provider();
    const notes = [document('Alpha.md', 1), document('Beta.md', 2)];

    await index.update(notes, embedder, 1);
    expect(embedder.embed).toHaveBeenCalledTimes(2);
    expect(index.size).toBe(2);

    await index.update(notes, embedder, 10);
    expect(embedder.embed).toHaveBeenCalledTimes(2);

    await index.update([document('Alpha.md', 3)], embedder, 10);
    expect(embedder.embed).toHaveBeenCalledTimes(3);
    expect(index.size).toBe(1);
  });

  it('invalidates cache when the provider identity changes', async () => {
    const index = new SemanticIndex();
    const first = provider('test:first');
    const second = provider('test:second');
    const notes = [document('Alpha.md', 1)];

    await index.update(notes, first, 10);
    await index.update(notes, second, 10);

    expect(first.embed).toHaveBeenCalledOnce();
    expect(second.embed).toHaveBeenCalledOnce();
  });

  it('serializes normalized vectors and scores queries with cosine similarity', async () => {
    const index = new SemanticIndex();
    const embedder = provider();
    await index.update([document('Alpha.md', 1), document('Beta.md', 1)], embedder, 10);

    const scores = await index.score('alpha concept', embedder);
    const restored = new SemanticIndex();
    restored.load(index.serialize());

    expect(scores.get('Alpha.md')).toBeCloseTo(1);
    expect(scores.get('Beta.md')).toBeCloseTo(0);
    expect(restored.size).toBe(2);
  });

  it('rejects incomplete and invalid embedding responses', async () => {
    const index = new SemanticIndex();
    const incomplete: EmbeddingProvider = { id: 'bad', embed: async () => [] };
    const invalid: EmbeddingProvider = { id: 'invalid', embed: async () => [[0, 0]] };

    await expect(index.update([document('Alpha.md', 1)], incomplete, 10)).rejects.toThrow(
      'returned 0 vectors for 1 documents',
    );
    await expect(index.update([document('Alpha.md', 1)], invalid, 10)).rejects.toThrow('invalid vector');
  });
});

describe('cosineSimilarity', () => {
  it('normalizes vectors and handles incompatible values', () => {
    expect(cosineSimilarity([2, 0], [5, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosineSimilarity([1], [1, 0])).toBe(0);
    expect(cosineSimilarity([], [])).toBe(0);
  });
});
