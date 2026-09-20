import {
  getAllTags,
  MarkdownView,
  Notice,
  normalizePath,
  Platform,
  Plugin,
  requestUrl,
  TFile,
  type TAbstractFile,
} from 'obsidian';

import { OllamaEmbeddingProvider } from './ollama-provider';
import {
  INDEX_READ_BATCH_SIZE,
  IndexStartupCoordinator,
  IndexUpdateBuffer,
  runBatched,
} from './index-lifecycle';
import { ARCTIC_EMBED_XS_INT8 } from './model-assets/manifest';
import { ObsidianModelAssetStore } from './model-assets/obsidian-store';
import {
  createRequestUrlModelAssetFetcher,
  VerifiedModelAssetManager,
} from './model-assets/verified-model-manager';
import { OnDeviceEmbeddingProvider } from './on-device/provider';
import {
  createIndexSettingsSignature,
  LexicalIndexDiskStore,
  planIndexReconciliation,
  type LexicalIndexJournalOperation,
} from './persistent-index';
import { parseQuery } from './query';
import {
  normalizeResultDisplayMode,
  normalizeVerboseContextCharacters,
} from './result-display';
import {
  RankedSearchIndex,
  type ResultFilters,
  type SearchResponse,
  type SortMode,
} from './search-engine';
import { ScottSearchView, VIEW_TYPE_SCOTTSEARCH } from './search-view';
import {
  SemanticIndex,
  type EmbeddingProvider,
  type SerializedEmbeddingCache,
} from './semantic-index';
import {
  DEFAULT_SETTINGS,
  ScottSearchSettingTab,
  type ScottSearchSettings,
} from './settings';

declare const SCOTTSEARCH_ON_DEVICE_EXPERIMENT: boolean;
declare const SCOTTSEARCH_MOBILE_ON_DEVICE_LAB: boolean;

const LEXICAL_CACHE_SNAPSHOT = 'lexical-index-v1.json.gz';
const LEXICAL_CACHE_JOURNAL = 'lexical-index-v1.journal';
const LEXICAL_CACHE_COMPACT_AFTER = 500;
const LEXICAL_CACHE_IDLE_COMPACT_MS = 30_000;

export interface IndexStatus {
  phase: 'idle' | 'lexical' | 'semantic' | 'ready';
  indexedFiles: number;
  totalFiles: number;
  semanticFiles: number;
  lastError?: string;
}

export interface SearchExecution extends SearchResponse {
  semanticActive: boolean;
  fallbackReason?: string;
}

interface PersistedData {
  settings?: Partial<ScottSearchSettings>;
  embeddings?: SerializedEmbeddingCache;
}

export default class ScottSearchPlugin extends Plugin {
  settings: ScottSearchSettings = { ...DEFAULT_SETTINGS };
  readonly lexicalIndex = new RankedSearchIndex();
  readonly semanticIndex = new SemanticIndex();
  modelAssetManager?: VerifiedModelAssetManager;

  private persistedEmbeddings: SerializedEmbeddingCache = {};
  private status: IndexStatus = {
    indexedFiles: 0,
    phase: 'idle',
    semanticFiles: 0,
    totalFiles: 0,
  };
  private readonly statusListeners = new Set<(status: IndexStatus) => void>();
  private readonly updateTimers = new Map<string, number>();
  private readonly semanticQueryCache = new Map<string, Map<string, number>>();
  private indexGeneration = 0;
  private semanticGeneration = 0;
  private semanticAbortController?: AbortController;
  private semanticUpdateTimer?: number;
  private onDeviceProvider?: OnDeviceEmbeddingProvider;
  private saveQueue: Promise<void> = Promise.resolve();
  private lexicalDiskStore?: LexicalIndexDiskStore;
  private lexicalCacheLoaded = false;
  private lexicalJournalOperations = 0;
  private lexicalCompactTimer?: number;
  private readonly startupIndex = new IndexStartupCoordinator({
    clear: (handle) => window.clearTimeout(handle),
    set: (callback, delayMs) => window.setTimeout(callback, delayMs),
  });
  private readonly indexUpdates = new IndexUpdateBuffer<TFile>((file) => file.path);

  async onload(): Promise<void> {
    const pluginDirectory = normalizePath(this.manifest.dir
      ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`);
    this.lexicalDiskStore = new LexicalIndexDiskStore(
      this.app.vault.adapter,
      normalizePath(`${pluginDirectory}/${LEXICAL_CACHE_SNAPSHOT}`),
      normalizePath(`${pluginDirectory}/${LEXICAL_CACHE_JOURNAL}`),
    );
    if (SCOTTSEARCH_ON_DEVICE_EXPERIMENT) {
      this.modelAssetManager = new VerifiedModelAssetManager(
        normalizePath(`${pluginDirectory}/model-assets`),
        ARCTIC_EMBED_XS_INT8,
        new ObsidianModelAssetStore(this.app.vault.adapter),
        { fetchAsset: createRequestUrlModelAssetFetcher(requestUrl) },
      );
    }
    await this.loadPluginData();
    await this.loadLexicalCache();

    this.registerView(VIEW_TYPE_SCOTTSEARCH, (leaf) => new ScottSearchView(leaf, this));
    this.addRibbonIcon('search', 'Open ScottSearch', () => void this.activateView());
    this.addCommand({
      callback: () => void this.activateView(),
      id: 'open-search',
      name: 'Open search',
    });
    this.addCommand({
      callback: () => {
        const selection = this.app.workspace.getActiveViewOfType(MarkdownView)?.editor.getSelection().trim() ?? '';
        void this.activateView(selection);
      },
      id: 'search-selection',
      name: 'Search selected text',
    });
    this.addSettingTab(new ScottSearchSettingTab(this));

    this.registerEvent(this.app.vault.on('create', (file) => this.queueFileUpdate(file)));
    this.registerEvent(this.app.vault.on('modify', (file) => this.queueFileUpdate(file)));
    this.registerEvent(this.app.vault.on('delete', (file) => this.removeFile(file.path)));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      this.removeFile(oldPath);
      this.queueFileUpdate(file);
    }));
    this.registerEvent(this.app.metadataCache.on('changed', (file) => this.queueFileUpdate(file)));

    this.app.workspace.onLayoutReady(() => {
      if (this.status.phase !== 'idle') return;
      this.startupIndex.afterLayoutReady(() => void this.reconcileIndex());
    });
  }

  onunload(): void {
    this.startupIndex.cancel();
    this.indexUpdates.clear();
    this.indexGeneration += 1;
    this.semanticGeneration += 1;
    this.semanticAbortController?.abort();
    this.semanticAbortController = undefined;
    this.disposeOnDeviceProvider();
    for (const timer of this.updateTimers.values()) window.clearTimeout(timer);
    if (this.semanticUpdateTimer !== undefined) window.clearTimeout(this.semanticUpdateTimer);
    if (this.lexicalCompactTimer !== undefined) window.clearTimeout(this.lexicalCompactTimer);
    void this.lexicalDiskStore?.flush();
    this.modelAssetManager?.cancelInstall();
  }

  async activateView(query = ''): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_SCOTTSEARCH)[0];
    if (!leaf) {
      leaf = this.app.workspace.getLeftLeaf(false) ?? this.app.workspace.getLeaf('tab');
      await leaf.setViewState({ active: true, type: VIEW_TYPE_SCOTTSEARCH });
    }
    await this.app.workspace.revealLeaf(leaf);
    this.startIndexNow();
    if (leaf.view instanceof ScottSearchView) leaf.view.setQuery(query);
  }

  async search(rawQuery: string, sort: SortMode, filters: ResultFilters): Promise<SearchExecution> {
    this.startIndexNow();
    const query = parseQuery(rawQuery);
    await this.hydratePaths(this.lexicalIndex.phraseContentCandidates(query));
    let semanticScores: Map<string, number> | undefined;
    let fallbackReason: string | undefined;

    if (this.settings.semanticEnabled && query.semanticText && query.errors.length === 0) {
      if (this.semanticIndex.size === 0) {
        fallbackReason = this.status.lastError ?? 'Semantic index is not ready.';
      } else {
        try {
          const provider = this.createEmbeddingProvider();
          const cacheKey = `${provider.id}\n${query.semanticText}`;
          semanticScores = this.semanticQueryCache.get(cacheKey);
          if (!semanticScores) {
            semanticScores = await this.semanticIndex.score(query.semanticText, provider);
            if (semanticScores.size === 0 && this.lexicalIndex.size > 0) {
              semanticScores = undefined;
              fallbackReason = 'No embeddings match the configured endpoint and model. Rebuild the semantic index.';
            }
            if (semanticScores) this.semanticQueryCache.set(cacheKey, semanticScores);
            while (this.semanticQueryCache.size > 20) {
              const { value: oldestKey } = this.semanticQueryCache.keys().next();
              if (oldestKey) this.semanticQueryCache.delete(oldestKey);
              else break;
            }
          }
        } catch (error) {
          fallbackReason = readableError(error);
        }
      }
    }

    const runSearch = (): SearchResponse => this.lexicalIndex.searchParsed(query, {
        filters,
        limit: this.settings.resultLimit,
        semanticScores,
        semanticWeight: this.settings.semanticWeight,
        sort,
        verboseContextCharacters: this.settings.verboseContextCharacters,
      });
    let response = runSearch();
    const displayPaths = this.lexicalIndex.pathsMissingContent(
      response.results.map((result) => result.path),
    );
    if (displayPaths.length > 0) {
      await this.hydratePaths(displayPaths);
      response = runSearch();
    }

    return {
      ...response,
      fallbackReason,
      semanticActive: semanticScores !== undefined,
    };
  }

  async reconcileIndex(): Promise<void> {
    const generation = this.beginIndexPass();
    const files = this.app.vault.getMarkdownFiles().filter((file) => !this.isIgnored(file.path));
    const plan = planIndexReconciliation(
      this.lexicalIndex.listFingerprints(),
      files.map((file) => ({ file, mtime: file.stat.mtime, path: file.path, size: file.stat.size })),
    );

    for (const path of plan.removed) this.removeFile(path, false);
    for (const { file } of plan.unchanged) this.indexUpdates.markProcessed(file.path);
    this.setStatus({
      indexedFiles: this.lexicalIndex.size,
      phase: 'lexical',
      semanticFiles: this.semanticIndex.size,
      totalFiles: files.length,
    });

    const completed = await runBatched(plan.changed, async ({ file }) => this.indexFile(file, false), {
      batchSize: INDEX_READ_BATCH_SIZE,
      isCurrent: () => generation === this.indexGeneration,
      onBatchComplete: () => this.setStatus({ ...this.status, indexedFiles: this.lexicalIndex.size }),
      yieldControl: yieldToEventLoop,
    });
    if (!completed) return;

    if (!this.lexicalCacheLoaded || plan.changed.length + plan.removed.length >= LEXICAL_CACHE_COMPACT_AFTER) {
      await this.compactLexicalCache();
    } else {
      for (const path of plan.removed) await this.appendLexicalCache({ path, type: 'remove' });
      for (const { file } of plan.changed) {
        if (this.lexicalIndex.has(file.path)) {
          await this.appendLexicalCache({
            document: this.lexicalIndex.serializeDocument(file.path),
            type: 'upsert',
          });
        }
      }
    }

    this.indexUpdates.finishRebuild((file) => this.queueFileUpdate(file));
    if (this.settings.semanticEnabled) await this.rebuildSemanticIndex();
    else this.setStatus({ ...this.status, phase: 'ready', semanticFiles: this.semanticIndex.size });
  }

  async rebuildIndex(): Promise<void> {
    const generation = this.beginIndexPass();
    this.lexicalIndex.clear();

    const files = this.app.vault.getMarkdownFiles().filter((file) => !this.isIgnored(file.path));
    this.setStatus({ indexedFiles: 0, phase: 'lexical', semanticFiles: 0, totalFiles: files.length });

    const completed = await runBatched(files, async (file) => this.indexFile(file, false), {
      batchSize: INDEX_READ_BATCH_SIZE,
      isCurrent: () => generation === this.indexGeneration,
      onBatchComplete: (indexedFiles) => this.setStatus({ ...this.status, indexedFiles }),
      yieldControl: yieldToEventLoop,
    });
    if (!completed) return;
    await this.compactLexicalCache();
    this.indexUpdates.finishRebuild((file) => this.queueFileUpdate(file));
    if (this.settings.semanticEnabled) await this.rebuildSemanticIndex();
    else this.setStatus({ ...this.status, phase: 'ready', semanticFiles: this.semanticIndex.size });
  }

  async rebuildSemanticIndex(): Promise<void> {
    if (!this.settings.semanticEnabled) {
      this.setStatus({ ...this.status, phase: 'ready' });
      return;
    }

    this.semanticAbortController?.abort();
    const controller = new AbortController();
    this.semanticAbortController = controller;
    const generation = ++this.semanticGeneration;
    this.semanticQueryCache.clear();
    this.setStatus({ ...this.status, lastError: undefined, phase: 'semantic' });
    try {
      const provider = this.createEmbeddingProvider();
      const hydrated = await this.hydratePaths(this.semanticIndex.pathsNeedingUpdate(
        this.lexicalIndex.listDocuments(),
        provider.id,
      ), () => generation === this.semanticGeneration && !controller.signal.aborted);
      if (!hydrated) return;
      await this.semanticIndex.update(
        this.lexicalIndex.listDocuments(),
        provider,
        this.settings.embeddingBatchSize,
        ({ completed }) => {
          if (generation === this.semanticGeneration) {
            this.setStatus({ ...this.status, semanticFiles: completed });
          }
        },
        controller.signal,
      );
      if (generation !== this.semanticGeneration) return;
      this.persistedEmbeddings = this.semanticIndex.serialize();
      await this.savePluginData();
      this.setStatus({ ...this.status, phase: 'ready', semanticFiles: this.semanticIndex.size });
    } catch (error) {
      if (generation !== this.semanticGeneration) return;
      this.setStatus({ ...this.status, lastError: readableError(error), phase: 'ready' });
    } finally {
      if (this.semanticAbortController === controller) this.semanticAbortController = undefined;
    }
  }

  async clearEmbeddingCache(): Promise<void> {
    this.semanticGeneration += 1;
    this.semanticAbortController?.abort();
    this.semanticAbortController = undefined;
    this.disposeOnDeviceProvider();
    this.semanticIndex.clear();
    this.persistedEmbeddings = {};
    this.semanticQueryCache.clear();
    this.setStatus({ ...this.status, lastError: undefined, semanticFiles: 0 });
    await this.savePluginData();
    new Notice('ScottSearch embedding cache cleared.');
  }

  async semanticToggleChanged(enabled: boolean): Promise<void> {
    this.semanticGeneration += 1;
    this.semanticAbortController?.abort();
    this.semanticAbortController = undefined;
    this.semanticQueryCache.clear();
    if (!enabled) {
      this.disposeOnDeviceProvider();
      this.setStatus({ ...this.status, lastError: undefined, phase: 'ready' });
      return;
    }
    await this.rebuildSemanticIndex();
  }

  async semanticConfigurationChanged(): Promise<void> {
    this.semanticGeneration += 1;
    this.semanticAbortController?.abort();
    this.semanticAbortController = undefined;
    this.disposeOnDeviceProvider();
    this.semanticQueryCache.clear();
    if (this.settings.semanticEnabled) await this.rebuildSemanticIndex();
  }

  modelAssetsChanged(): void {
    this.semanticGeneration += 1;
    this.semanticAbortController?.abort();
    this.semanticAbortController = undefined;
    this.disposeOnDeviceProvider();
    this.semanticQueryCache.clear();
    if (this.settings.semanticEnabled && this.settings.semanticProvider === 'on-device') {
      void this.rebuildSemanticIndex();
    }
  }

  subscribeToStatus(listener: (status: IndexStatus) => void): () => void {
    this.statusListeners.add(listener);
    listener({ ...this.status });
    return () => this.statusListeners.delete(listener);
  }

  describeIndexStatus(): string {
    const semantic = this.settings.semanticEnabled
      ? `${this.status.semanticFiles}/${this.status.totalFiles} semantic`
      : 'semantic disabled';
    const error = this.status.lastError ? ` Last error: ${this.status.lastError}` : '';
    return `${this.status.indexedFiles}/${this.status.totalFiles} notes indexed; ${semantic}.${error}`;
  }

  savePluginData(): Promise<void> {
    this.saveQueue = this.saveQueue.then(async () => {
      await this.saveData({ embeddings: this.persistedEmbeddings, settings: this.settings } satisfies PersistedData);
    });
    return this.saveQueue;
  }

  private async loadPluginData(): Promise<void> {
    const data = (await this.loadData()) as PersistedData | null;
    this.settings = { ...DEFAULT_SETTINGS, ...(data?.settings ?? {}) };
    this.settings.resultDisplayMode = normalizeResultDisplayMode(this.settings.resultDisplayMode);
    this.settings.verboseContextCharacters = normalizeVerboseContextCharacters(
      this.settings.verboseContextCharacters,
    );
    if (!SCOTTSEARCH_ON_DEVICE_EXPERIMENT && this.settings.semanticProvider === 'on-device') {
      this.settings.semanticProvider = 'ollama';
    }
    this.persistedEmbeddings = data?.embeddings ?? {};
    this.semanticIndex.load(this.persistedEmbeddings);
    this.status.semanticFiles = this.semanticIndex.size;
  }

  private createEmbeddingProvider(): EmbeddingProvider {
    if (SCOTTSEARCH_ON_DEVICE_EXPERIMENT && this.settings.semanticProvider === 'on-device') {
      if (!Platform.isDesktopApp && !SCOTTSEARCH_MOBILE_ON_DEVICE_LAB) {
        throw new Error('The experimental on-device model is available only in Obsidian for desktop.');
      }
      if (!this.onDeviceProvider || this.onDeviceProvider.isDisposed) {
        if (!this.modelAssetManager) throw new Error('The on-device model manager is unavailable.');
        this.onDeviceProvider = new OnDeviceEmbeddingProvider(this.modelAssetManager);
      }
      return this.onDeviceProvider;
    }
    return new OllamaEmbeddingProvider(this.settings.ollamaEndpoint, this.settings.ollamaModel);
  }

  private disposeOnDeviceProvider(): void {
    this.onDeviceProvider?.dispose();
    this.onDeviceProvider = undefined;
  }

  private startIndexNow(): void {
    if (this.status.phase !== 'idle') return;
    this.startupIndex.runNow(() => void this.reconcileIndex());
  }

  private beginIndexPass(): number {
    this.startupIndex.cancel();
    this.indexUpdates.beginRebuild();
    for (const timer of this.updateTimers.values()) window.clearTimeout(timer);
    this.updateTimers.clear();
    if (this.semanticUpdateTimer !== undefined) window.clearTimeout(this.semanticUpdateTimer);
    this.semanticUpdateTimer = undefined;
    const generation = ++this.indexGeneration;
    this.semanticGeneration += 1;
    this.semanticAbortController?.abort();
    this.semanticAbortController = undefined;
    this.semanticQueryCache.clear();
    return generation;
  }

  private async loadLexicalCache(): Promise<void> {
    const store = this.lexicalDiskStore;
    if (!store) return;
    try {
      const cached = await store.load(this.indexSettingsSignature());
      if (!cached) return;
      this.lexicalIndex.load(cached.index);
      this.lexicalCacheLoaded = true;
      this.lexicalJournalOperations = cached.journalOperations;
      this.status.indexedFiles = this.lexicalIndex.size;
      this.status.totalFiles = this.lexicalIndex.size;
      if (cached.journalOperations > 0) this.scheduleLexicalCacheCompaction();
    } catch {
      this.lexicalCacheLoaded = false;
    }
  }

  private async hydratePaths(
    paths: readonly string[],
    isCurrent: () => boolean = () => true,
  ): Promise<boolean> {
    const files = [...new Set(paths)]
      .map((path) => this.app.vault.getAbstractFileByPath(path))
      .filter((file): file is TFile => (
        file instanceof TFile
        && file.extension === 'md'
        && !this.isIgnored(file.path)
      ));
    return runBatched(files, async (file) => this.indexFile(file, false), {
      batchSize: INDEX_READ_BATCH_SIZE,
      isCurrent,
      yieldControl: yieldToEventLoop,
    });
  }

  private async indexFile(file: TFile, persist = true): Promise<void> {
    if (this.isIgnored(file.path)) {
      this.removeFile(file.path, persist);
      return;
    }
    if (this.app.vault.getAbstractFileByPath(file.path) !== file) {
      this.removeFile(file.path, persist);
      return;
    }
    const content = file.stat.size <= this.settings.maxFileSizeKb * 1024
      ? await this.app.vault.cachedRead(file)
      : '';
    const cache = this.app.metadataCache.getFileCache(file);
    this.lexicalIndex.upsert({
      basename: file.basename,
      content,
      ctime: file.stat.ctime,
      extension: file.extension,
      mtime: file.stat.mtime,
      path: file.path,
      size: file.stat.size,
      tags: cache ? (getAllTags(cache) ?? []) : [],
    });
    this.indexUpdates.markProcessed(file.path);
    if (persist) {
      await this.appendLexicalCache({
        document: this.lexicalIndex.serializeDocument(file.path),
        type: 'upsert',
      });
    }
  }

  private queueFileUpdate(file: TAbstractFile): void {
    if (!(file instanceof TFile) || file.extension !== 'md') return;
    if (this.indexUpdates.defer(file)) return;
    const previous = this.updateTimers.get(file.path);
    if (previous !== undefined) window.clearTimeout(previous);
    const timer = window.setTimeout(() => {
      this.updateTimers.delete(file.path);
      void this.indexFile(file).then(() => {
        this.setStatus({ ...this.status, indexedFiles: this.lexicalIndex.size, totalFiles: this.lexicalIndex.size });
        if (this.settings.semanticEnabled) this.scheduleSemanticUpdate();
      });
    }, 250);
    this.updateTimers.set(file.path, timer);
  }

  private removeFile(path: string, persist = true): void {
    const timer = this.updateTimers.get(path);
    if (timer !== undefined) window.clearTimeout(timer);
    this.updateTimers.delete(path);
    this.indexUpdates.remove(path);
    const hadLexicalDocument = this.lexicalIndex.has(path);
    this.lexicalIndex.remove(path);
    this.semanticIndex.remove(path);
    const hadCachedEmbedding = this.persistedEmbeddings[path] !== undefined;
    delete this.persistedEmbeddings[path];
    this.semanticQueryCache.clear();
    this.setStatus({
      ...this.status,
      indexedFiles: this.lexicalIndex.size,
      semanticFiles: this.semanticIndex.size,
      totalFiles: this.lexicalIndex.size,
    });
    if (persist && hadLexicalDocument) {
      void this.appendLexicalCache({ path, type: 'remove' });
    }
    if (hadCachedEmbedding) void this.savePluginData();
    if (this.settings.semanticEnabled && this.indexUpdates.isReady) this.scheduleSemanticUpdate();
  }

  private scheduleSemanticUpdate(): void {
    if (this.semanticUpdateTimer !== undefined) window.clearTimeout(this.semanticUpdateTimer);
    this.semanticUpdateTimer = window.setTimeout(() => {
      this.semanticUpdateTimer = undefined;
      void this.rebuildSemanticIndex();
    }, 1000);
  }

  private indexSettingsSignature(): string {
    return createIndexSettingsSignature(this.settings);
  }

  private async appendLexicalCache(operation: LexicalIndexJournalOperation): Promise<void> {
    const store = this.lexicalDiskStore;
    if (!store || !this.lexicalCacheLoaded) {
      await this.compactLexicalCache();
      return;
    }
    try {
      await store.append(operation);
      this.lexicalJournalOperations += 1;
      if (this.lexicalJournalOperations >= LEXICAL_CACHE_COMPACT_AFTER) {
        await this.compactLexicalCache();
      } else {
        this.scheduleLexicalCacheCompaction();
      }
    } catch {
      this.lexicalCacheLoaded = false;
    }
  }

  private async compactLexicalCache(): Promise<void> {
    const store = this.lexicalDiskStore;
    if (!store) return;
    if (this.lexicalCompactTimer !== undefined) window.clearTimeout(this.lexicalCompactTimer);
    this.lexicalCompactTimer = undefined;
    try {
      await store.compact(() => this.lexicalIndex.serialize(), this.indexSettingsSignature());
      this.lexicalCacheLoaded = true;
      this.lexicalJournalOperations = 0;
    } catch {
      this.lexicalCacheLoaded = false;
    }
  }

  private scheduleLexicalCacheCompaction(): void {
    if (this.lexicalCompactTimer !== undefined) window.clearTimeout(this.lexicalCompactTimer);
    this.lexicalCompactTimer = window.setTimeout(() => {
      this.lexicalCompactTimer = undefined;
      void this.compactLexicalCache();
    }, LEXICAL_CACHE_IDLE_COMPACT_MS);
  }

  private isIgnored(path: string): boolean {
    return this.settings.ignoredFolders.some((folder) => path === folder || path.startsWith(`${folder}/`));
  }

  private setStatus(status: IndexStatus): void {
    this.status = status;
    for (const listener of this.statusListeners) listener({ ...status });
  }
}

function readableError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}
