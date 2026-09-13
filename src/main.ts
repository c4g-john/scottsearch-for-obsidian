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
import { ARCTIC_EMBED_XS_INT8 } from './model-assets/manifest';
import { ObsidianModelAssetStore } from './model-assets/obsidian-store';
import {
  createRequestUrlModelAssetFetcher,
  VerifiedModelAssetManager,
} from './model-assets/verified-model-manager';
import { OnDeviceEmbeddingProvider } from './on-device/provider';
import { parseQuery } from './query';
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

  async onload(): Promise<void> {
    if (SCOTTSEARCH_ON_DEVICE_EXPERIMENT) {
      const pluginDirectory = this.manifest.dir
        ?? normalizePath(`${this.app.vault.configDir}/plugins/${this.manifest.id}`);
      this.modelAssetManager = new VerifiedModelAssetManager(
        normalizePath(`${pluginDirectory}/model-assets`),
        ARCTIC_EMBED_XS_INT8,
        new ObsidianModelAssetStore(this.app.vault.adapter),
        { fetchAsset: createRequestUrlModelAssetFetcher(requestUrl) },
      );
    }
    await this.loadPluginData();

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

    this.app.workspace.onLayoutReady(() => void this.rebuildIndex());
  }

  onunload(): void {
    this.indexGeneration += 1;
    this.semanticGeneration += 1;
    this.semanticAbortController?.abort();
    this.semanticAbortController = undefined;
    this.disposeOnDeviceProvider();
    for (const timer of this.updateTimers.values()) window.clearTimeout(timer);
    if (this.semanticUpdateTimer !== undefined) window.clearTimeout(this.semanticUpdateTimer);
    this.modelAssetManager?.cancelInstall();
  }

  async activateView(query = ''): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_SCOTTSEARCH)[0];
    if (!leaf) {
      leaf = this.app.workspace.getLeftLeaf(false) ?? this.app.workspace.getLeaf('tab');
      await leaf.setViewState({ active: true, type: VIEW_TYPE_SCOTTSEARCH });
    }
    await this.app.workspace.revealLeaf(leaf);
    if (leaf.view instanceof ScottSearchView) leaf.view.setQuery(query);
  }

  async search(rawQuery: string, sort: SortMode, filters: ResultFilters): Promise<SearchExecution> {
    const query = parseQuery(rawQuery);
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

    return {
      ...this.lexicalIndex.searchParsed(query, {
        filters,
        limit: this.settings.resultLimit,
        semanticScores,
        semanticWeight: this.settings.semanticWeight,
        sort,
      }),
      fallbackReason,
      semanticActive: semanticScores !== undefined,
    };
  }

  async rebuildIndex(): Promise<void> {
    const generation = ++this.indexGeneration;
    this.semanticGeneration += 1;
    this.semanticAbortController?.abort();
    this.semanticAbortController = undefined;
    this.lexicalIndex.clear();
    this.semanticQueryCache.clear();

    const files = this.app.vault.getMarkdownFiles().filter((file) => !this.isIgnored(file.path));
    this.setStatus({ indexedFiles: 0, phase: 'lexical', semanticFiles: 0, totalFiles: files.length });

    for (let offset = 0; offset < files.length; offset += 20) {
      if (generation !== this.indexGeneration) return;
      const batch = files.slice(offset, offset + 20);
      await Promise.all(batch.map(async (file) => this.indexFile(file)));
      this.setStatus({ ...this.status, indexedFiles: Math.min(offset + batch.length, files.length) });
      await yieldToEventLoop();
    }

    if (generation !== this.indexGeneration) return;
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
      await this.semanticIndex.update(
        this.lexicalIndex.listDocuments(),
        this.createEmbeddingProvider(),
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

  private async indexFile(file: TFile): Promise<void> {
    if (this.isIgnored(file.path)) {
      this.removeFile(file.path);
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
      tags: cache ? (getAllTags(cache) ?? []) : [],
    });
  }

  private queueFileUpdate(file: TAbstractFile): void {
    if (!(file instanceof TFile) || file.extension !== 'md') return;
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

  private removeFile(path: string): void {
    const timer = this.updateTimers.get(path);
    if (timer !== undefined) window.clearTimeout(timer);
    this.updateTimers.delete(path);
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
    if (hadCachedEmbedding) void this.savePluginData();
    if (this.settings.semanticEnabled) this.scheduleSemanticUpdate();
  }

  private scheduleSemanticUpdate(): void {
    if (this.semanticUpdateTimer !== undefined) window.clearTimeout(this.semanticUpdateTimer);
    this.semanticUpdateTimer = window.setTimeout(() => {
      this.semanticUpdateTimer = undefined;
      void this.rebuildSemanticIndex();
    }, 1000);
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
