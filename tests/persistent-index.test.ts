import { describe, expect, it, vi } from 'vitest';
import { gzipSync, strToU8 } from 'fflate';

import { createScaleDocuments } from '../benchmarks/scale-benchmark';
import {
  createIndexSettingsSignature,
  decodeLexicalIndexSnapshot,
  encodeLexicalIndexSnapshot,
  LexicalIndexDiskStore,
  planIndexReconciliation,
  type LexicalIndexFileAdapter,
} from '../src/persistent-index';
import {
  RankedSearchIndex,
  type SearchDocumentFingerprint,
  type SerializedLexicalDocument,
  type SerializedLexicalIndex,
} from '../src/search-engine';

function cachedDocument(overrides: Partial<SerializedLexicalDocument> = {}): SerializedLexicalDocument {
  return {
    basename: 'Alpha',
    ctime: 10,
    extension: 'md',
    mtime: 20,
    path: 'Notes/Alpha.md',
    size: 30,
    tags: ['example'],
    termFrequency: { alpha: 2, concept: 1 },
    tokenCount: 3,
    ...overrides,
  };
}

class MemoryAdapter implements LexicalIndexFileAdapter {
  readonly files = new Map<string, string>();

  async append(path: string, data: string): Promise<void> {
    this.files.set(path, `${this.files.get(path) ?? ''}${data}`);
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  async read(path: string): Promise<string> {
    const value = this.files.get(path);
    if (value === undefined) throw new Error('Missing test file.');
    return value;
  }

  async readBinary(path: string): Promise<ArrayBuffer> {
    const value = this.files.get(path);
    if (value === undefined) throw new Error('Missing test file.');
    return Uint8Array.from(JSON.parse(value) as number[]).buffer;
  }

  async write(path: string, data: string): Promise<void> {
    this.files.set(path, data);
  }

  async writeBinary(path: string, data: ArrayBuffer): Promise<void> {
    this.files.set(path, JSON.stringify([...new Uint8Array(data)]));
  }
}

describe('persistent lexical index', () => {
  it('normalizes index-affecting settings into a stable signature', () => {
    expect(createIndexSettingsSignature({
      ignoredFolders: ['/Private/', 'Archive'],
      maxFileSizeKb: 1024.9,
    })).toBe(createIndexSettingsSignature({
      ignoredFolders: ['Archive', 'Private'],
      maxFileSizeKb: 1024,
    }));
  });

  it('plans a warm startup without reading unchanged note bodies', async () => {
    const cached = [
      { mtime: 10, path: 'Alpha.md', size: 100 },
      { mtime: 20, path: 'Beta.md', size: 200 },
    ];
    const current = cached.map((file) => ({ ...file, source: file.path }));
    const readNote = vi.fn(async (_file: SearchDocumentFingerprint) => undefined);

    const plan = planIndexReconciliation(cached, current);
    for (const file of plan.changed) await readNote(file);

    expect(plan).toEqual({ changed: [], removed: [], unchanged: current });
    expect(readNote).not.toHaveBeenCalled();
  });

  it('selects only changed and new files and removes missing paths', () => {
    const plan = planIndexReconciliation(
      [
        { mtime: 10, path: 'Changed.md', size: 100 },
        { mtime: 10, path: 'Deleted.md', size: 100 },
        { mtime: 10, path: 'Unchanged.md', size: 100 },
      ],
      [
        { mtime: 11, path: 'Changed.md', size: 100 },
        { mtime: 1, path: 'New.md', size: 20 },
        { mtime: 10, path: 'Unchanged.md', size: 100 },
      ],
    );

    expect(plan.changed.map((file) => file.path)).toEqual(['Changed.md', 'New.md']);
    expect(plan.removed).toEqual(['Deleted.md']);
    expect(plan.unchanged.map((file) => file.path)).toEqual(['Unchanged.md']);
  });

  it('rejects corrupt, incompatible, and differently configured snapshots', () => {
    const index: SerializedLexicalIndex = { documents: [cachedDocument()] };
    const encoded = encodeLexicalIndexSnapshot(index, 'settings-a');

    expect(decodeLexicalIndexSnapshot(encoded, 'settings-a')).toEqual(index);
    expect(decodeLexicalIndexSnapshot(encoded, 'settings-b')).toBeNull();
    expect(decodeLexicalIndexSnapshot(new TextEncoder().encode('{broken'), 'settings-a')).toBeNull();
    const incompatible = gzipSync(strToU8(JSON.stringify({
      index,
      settingsSignature: 'settings-a',
      version: 999,
    })));
    expect(decodeLexicalIndexSnapshot(incompatible, 'settings-a')).toBeNull();
  });

  it('compresses derived data below the synthetic source-text size without storing bodies', () => {
    const documents = createScaleDocuments(1_000);
    const index = new RankedSearchIndex();
    for (const document of documents) index.upsert(document);
    const snapshot = index.serialize();
    const compressed = encodeLexicalIndexSnapshot(snapshot, 'settings');
    const sourceBytes = documents.reduce((total, document) => total + document.content.length, 0);

    expect(snapshot.documents.every((document) => !('content' in document))).toBe(true);
    expect(compressed.byteLength).toBeLessThan(sourceBytes);
  });

  it('replays small append-only updates after a compact snapshot', async () => {
    const adapter = new MemoryAdapter();
    const store = new LexicalIndexDiskStore(adapter, 'snapshot', 'journal');
    const initial: SerializedLexicalIndex = {
      documents: [cachedDocument(), cachedDocument({ path: 'Deleted.md' })],
    };
    await store.compact(() => initial, 'settings');
    await store.append({
      document: cachedDocument({ mtime: 99, path: 'Notes/Alpha.md' }),
      type: 'upsert',
    });
    await store.append({ path: 'Deleted.md', type: 'remove' });

    const restored = await store.load('settings');

    expect(restored).toEqual({
      index: { documents: [cachedDocument({ mtime: 99, path: 'Notes/Alpha.md' })] },
      journalOperations: 2,
    });
  });

  it('ignores a damaged journal tail and safely falls back when the base is damaged', async () => {
    const adapter = new MemoryAdapter();
    const store = new LexicalIndexDiskStore(adapter, 'snapshot', 'journal');
    const initial: SerializedLexicalIndex = { documents: [cachedDocument()] };
    await store.compact(() => initial, 'settings');
    adapter.files.set('journal', '{not-json}\n');

    expect(await store.load('settings')).toEqual({ index: initial, journalOperations: 0 });

    adapter.files.set('snapshot', JSON.stringify([1, 2, 3]));
    expect(await store.load('settings')).toBeNull();
  });
});
