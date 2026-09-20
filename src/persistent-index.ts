import type {
  SearchDocumentFingerprint,
  SerializedLexicalDocument,
  SerializedLexicalIndex,
} from './search-engine';
import { gunzipSync, gzipSync, strFromU8, strToU8 } from 'fflate';

export const LEXICAL_INDEX_SCHEMA_VERSION = 1;

interface LexicalIndexSnapshot {
  version: typeof LEXICAL_INDEX_SCHEMA_VERSION;
  settingsSignature: string;
  index: SerializedLexicalIndex;
}

export type LexicalIndexJournalOperation =
  | { type: 'upsert'; document: SerializedLexicalDocument }
  | { type: 'remove'; path: string };

export interface LexicalIndexFileAdapter {
  append(path: string, data: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  readBinary(path: string): Promise<ArrayBuffer>;
  write(path: string, data: string): Promise<void>;
  writeBinary(path: string, data: ArrayBuffer): Promise<void>;
}

export interface IndexSettingsFingerprint {
  ignoredFolders: readonly string[];
  maxFileSizeKb: number;
}

export interface IndexReconciliationPlan<T extends SearchDocumentFingerprint> {
  changed: T[];
  removed: string[];
  unchanged: T[];
}

export interface LoadedLexicalIndex {
  index: SerializedLexicalIndex;
  journalOperations: number;
}

export function createIndexSettingsSignature(settings: IndexSettingsFingerprint): string {
  return JSON.stringify({
    ignoredFolders: [...settings.ignoredFolders]
      .map((folder) => folder.trim().replace(/^\/+|\/+$/gu, ''))
      .filter(Boolean)
      .sort(),
    maxFileSizeKb: Math.floor(settings.maxFileSizeKb),
  });
}

export function planIndexReconciliation<T extends SearchDocumentFingerprint>(
  cached: readonly SearchDocumentFingerprint[],
  current: readonly T[],
): IndexReconciliationPlan<T> {
  const cachedByPath = new Map(cached.map((file) => [file.path, file]));
  const currentPaths = new Set(current.map((file) => file.path));
  const changed: T[] = [];
  const unchanged: T[] = [];

  for (const file of current) {
    const previous = cachedByPath.get(file.path);
    if (previous?.mtime === file.mtime && previous.size === file.size) unchanged.push(file);
    else changed.push(file);
  }

  return {
    changed,
    removed: cached.filter((file) => !currentPaths.has(file.path)).map((file) => file.path),
    unchanged,
  };
}

export function encodeLexicalIndexSnapshot(
  index: SerializedLexicalIndex,
  settingsSignature: string,
): Uint8Array {
  return gzipSync(strToU8(JSON.stringify({
    index,
    settingsSignature,
    version: LEXICAL_INDEX_SCHEMA_VERSION,
  } satisfies LexicalIndexSnapshot)));
}

export function decodeLexicalIndexSnapshot(
  raw: ArrayBuffer | Uint8Array,
  expectedSettingsSignature: string,
): SerializedLexicalIndex | null {
  try {
    const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
    const value = JSON.parse(strFromU8(gunzipSync(bytes))) as unknown;
    if (!isRecord(value)) return null;
    if (value.version !== LEXICAL_INDEX_SCHEMA_VERSION) return null;
    if (value.settingsSignature !== expectedSettingsSignature) return null;
    if (!isSerializedLexicalIndex(value.index)) return null;
    return value.index;
  } catch {
    return null;
  }
}

export class LexicalIndexDiskStore {
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly adapter: LexicalIndexFileAdapter,
    private readonly snapshotPath: string,
    private readonly journalPath: string,
  ) {}

  async load(settingsSignature: string): Promise<LoadedLexicalIndex | null> {
    if (!(await this.adapter.exists(this.snapshotPath))) return null;
    const snapshot = decodeLexicalIndexSnapshot(
      await this.adapter.readBinary(this.snapshotPath),
      settingsSignature,
    );
    if (!snapshot) return null;

    const documents = new Map(snapshot.documents.map((document) => [document.path, document]));
    let journalOperations = 0;
    if (await this.adapter.exists(this.journalPath)) {
      const journal = await this.adapter.read(this.journalPath);
      for (const line of journal.split('\n')) {
        if (!line.trim()) continue;
        const operation = decodeJournalOperation(line);
        if (!operation) continue;
        journalOperations += 1;
        if (operation.type === 'upsert') documents.set(operation.document.path, operation.document);
        else documents.delete(operation.path);
      }
    }
    return {
      index: { documents: [...documents.values()] },
      journalOperations,
    };
  }

  append(operation: LexicalIndexJournalOperation): Promise<void> {
    const line = `${JSON.stringify(operation)}\n`;
    this.writeQueue = this.writeQueue
      .catch(() => undefined)
      .then(async () => {
        if (await this.adapter.exists(this.journalPath)) {
          await this.adapter.append(this.journalPath, line);
        } else {
          await this.adapter.write(this.journalPath, line);
        }
      });
    return this.writeQueue;
  }

  compact(index: () => SerializedLexicalIndex, settingsSignature: string): Promise<void> {
    this.writeQueue = this.writeQueue.catch(() => undefined).then(async () => {
      const compressed = encodeLexicalIndexSnapshot(index(), settingsSignature);
      await this.adapter.writeBinary(
        this.snapshotPath,
        toArrayBuffer(compressed),
      );
      await this.adapter.write(this.journalPath, '');
    });
    return this.writeQueue;
  }

  flush(): Promise<void> {
    return this.writeQueue;
  }
}

function decodeJournalOperation(raw: string): LexicalIndexJournalOperation | null {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!isRecord(value)) return null;
    if (value.type === 'remove' && typeof value.path === 'string') {
      return { path: value.path, type: 'remove' };
    }
    if (value.type === 'upsert' && isSerializedLexicalDocument(value.document)) {
      return { document: value.document, type: 'upsert' };
    }
    return null;
  } catch {
    return null;
  }
}

function isSerializedLexicalIndex(value: unknown): value is SerializedLexicalIndex {
  return isRecord(value)
    && Array.isArray(value.documents)
    && value.documents.every(isSerializedLexicalDocument);
}

function isSerializedLexicalDocument(value: unknown): value is SerializedLexicalDocument {
  if (!isRecord(value)) return false;
  if (
    typeof value.path !== 'string'
    || typeof value.basename !== 'string'
    || typeof value.extension !== 'string'
    || !isNonNegativeFinite(value.ctime)
    || !isNonNegativeFinite(value.mtime)
    || !isNonNegativeFinite(value.size)
    || typeof value.tokenCount !== 'number'
    || !Number.isSafeInteger(value.tokenCount)
    || value.tokenCount < 0
    || !Array.isArray(value.tags)
    || !value.tags.every((tag) => typeof tag === 'string')
    || !isRecord(value.termFrequency)
  ) return false;

  return Object.entries(value.termFrequency).every(([term, frequency]) => (
    term.length > 0
    && typeof frequency === 'number'
    && Number.isSafeInteger(frequency)
    && frequency > 0
  ));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
}
