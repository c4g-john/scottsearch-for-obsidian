import { describe, expect, it } from 'vitest';

import { RankedSearchIndex, type SearchDocument } from '../src/search-engine';

const DAY = 86_400_000;
const NOW = new Date(2026, 0, 15).getTime();

function note(overrides: Partial<SearchDocument> & Pick<SearchDocument, 'path' | 'content'>): SearchDocument {
  const parts = overrides.path.split('/');
  const filename = parts[parts.length - 1] ?? overrides.path;
  return {
    basename: filename.replace(/\.md$/u, ''),
    ctime: NOW - 30 * DAY,
    extension: 'md',
    mtime: NOW - 2 * DAY,
    tags: [],
    ...overrides,
  };
}

function createIndex(): RankedSearchIndex {
  const index = new RankedSearchIndex();
  index.upsert(note({
    path: 'Engineering/Consensus protocol.md',
    content: 'Raft coordinates a replicated log across a cluster and elects a leader.',
    tags: ['distributed-systems'],
    ctime: new Date(2025, 0, 10).getTime(),
  }));
  index.upsert(note({
    path: 'People/Meeting notes.md',
    content: 'The team reached agreement about lunch after a long discussion.',
    tags: ['meetings'],
    ctime: new Date(2026, 0, 10).getTime(),
  }));
  index.upsert(note({
    path: 'Archive/Old distributed systems.md',
    content: 'An exact failure detector helps nodes reach consensus despite faults.',
    tags: ['draft', 'distributed-systems'],
    ctime: new Date(2024, 0, 10).getTime(),
    mtime: NOW - 400 * DAY,
  }));
  return index;
}

describe('RankedSearchIndex', () => {
  it('ranks title matches above body-only matches', () => {
    const response = createIndex().search('consensus', { now: NOW });

    expect(response.results.map((result) => result.path)).toEqual([
      'Engineering/Consensus protocol.md',
      'Archive/Old distributed systems.md',
    ]);
    expect(response.results[0]?.score).toBeGreaterThan(response.results[1]?.score ?? 0);
  });

  it('uses required phrases, exclusions, metadata, and dates as hard constraints', () => {
    const response = createIndex().search(
      'systems +"failure detector" -raft -tag:draft createdafter:2024-06-01',
      { now: NOW },
    );

    expect(response.results).toEqual([]);

    const allowed = createIndex().search(
      '+"failure detector" tag:distributed createdafter:2023-01-01 createdbefore:2025-01-01',
      { now: NOW },
    );
    expect(allowed.results.map((result) => result.path)).toEqual(['Archive/Old distributed systems.md']);
  });

  it('combines semantic scores with lexical relevance', () => {
    const index = createIndex();
    const semanticScores = new Map([
      ['Engineering/Consensus protocol.md', 0.96],
      ['People/Meeting notes.md', 0.31],
      ['Archive/Old distributed systems.md', 0.78],
    ]);

    const response = index.search('fault tolerant coordination', {
      now: NOW,
      semanticScores,
      semanticWeight: 0.9,
    });

    expect(response.results[0]?.path).toBe('Engineering/Consensus protocol.md');
    expect(response.results).toHaveLength(3);
    expect(response.results[0]?.semanticScore).toBe(0.96);
  });

  it('sorts, filters, and reports facets before interactive filters', () => {
    const response = createIndex().search('systems consensus meeting', {
      filters: { folder: 'Engineering' },
      now: NOW,
      sort: 'created-asc',
    });

    expect(response.results.map((result) => result.path)).toEqual(['Engineering/Consensus protocol.md']);
    expect(response.facets.folders).toEqual([
      { value: 'Archive', count: 1 },
      { value: 'Engineering', count: 1 },
      { value: 'People', count: 1 },
    ]);
    expect(response.facets.tags).toContainEqual({ value: 'distributed-systems', count: 2 });
  });

  it('updates document frequencies when notes change or disappear', () => {
    const index = createIndex();
    index.upsert(note({ path: 'People/Meeting notes.md', content: 'A completely rewritten note.' }));
    index.remove('Archive/Old distributed systems.md');

    expect(index.size).toBe(2);
    expect(index.search('consensus', { now: NOW }).results.map((result) => result.path)).toEqual([
      'Engineering/Consensus protocol.md',
    ]);
  });

  it('returns query errors without evaluating results', () => {
    const response = createIndex().search('createdafter:yesterday');

    expect(response.results).toEqual([]);
    expect(response.query.errors).toEqual([
      'createdafter: expected a real date in YYYY-MM-DD format.',
    ]);
  });

  it('supports exclusion-only discovery queries', () => {
    const response = createIndex().search('-draft', { now: NOW });

    expect(response.results.map((result) => result.path)).toEqual([
      'Engineering/Consensus protocol.md',
      'People/Meeting notes.md',
    ]);
  });
});
