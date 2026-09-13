const MARKER_FILENAME = 'scottsearch-model.json';
const MARKER_SCHEMA_VERSION = 1;
const MAX_ARTIFACT_BYTES = 256_000_000;
const MAX_MODEL_BYTES = 512_000_000;
const REQUEST_CHUNK_BYTES = 1_048_576;

export interface ModelAsset {
  path: string;
  url: string;
  bytes: number;
  sha256: string;
}

export interface ModelAssetManifest {
  id: string;
  displayName: string;
  revision: string;
  cacheKey: string;
  license: {
    name: string;
    url: string;
  };
  artifacts: ModelAsset[];
}

export interface ModelAssetStore {
  exists(path: string): Promise<boolean>;
  listDirectories(path: string): Promise<string[]>;
  listFiles(path: string): Promise<string[]>;
  makeDirectory(path: string): Promise<void>;
  readBinary(path: string): Promise<ArrayBuffer>;
  rename(from: string, to: string): Promise<void>;
  removeDirectory(path: string): Promise<void>;
  size(path: string): Promise<number | null>;
  writeBinary(path: string, data: ArrayBuffer): Promise<void>;
}

export interface ModelAssetFetchOptions {
  signal: AbortSignal;
  onProgress: (loadedBytes: number) => void;
}

export interface ModelAssetRequestUrlResponse {
  status: number;
  headers: Record<string, string>;
  arrayBuffer: ArrayBuffer;
}

export type ModelAssetRequestUrl = (request: {
  url: string;
  method: 'GET';
  headers: Record<string, string>;
  throw: false;
}) => Promise<ModelAssetRequestUrlResponse>;

export type ModelAssetFetcher = (
  asset: ModelAsset,
  options: ModelAssetFetchOptions,
) => Promise<ArrayBuffer>;

export type ModelAssetProgressPhase = 'downloading' | 'verifying' | 'activating';

export interface ModelAssetProgress {
  phase: ModelAssetProgressPhase;
  artifactPath?: string;
  artifactIndex: number;
  artifactCount: number;
  completedBytes: number;
  totalBytes: number;
}

export type ModelAssetState = 'not-installed' | 'ready' | 'invalid';

export interface ModelAssetStatus {
  state: ModelAssetState;
  diskBytes: number;
  expectedBytes: number;
  installedBytes: number;
  installedAt?: string;
  reason?: string;
}

export type VerifiedModelArtifacts = ReadonlyMap<string, ArrayBuffer>;

interface InstalledMarker {
  schemaVersion: number;
  fingerprint: string;
  installedAt: string;
  totalBytes: number;
}

export class ModelAssetManagerError extends Error {
  constructor(
    readonly code: 'cancelled' | 'integrity' | 'manifest' | 'network' | 'size' | 'storage',
    message: string,
  ) {
    super(message);
    this.name = 'ModelAssetManagerError';
  }
}

export interface VerifiedModelAssetManagerOptions {
  fetchAsset: ModelAssetFetcher;
  installationId?: () => string;
  now?: () => Date;
}

export class VerifiedModelAssetManager {
  private readonly fetchAsset: ModelAssetFetcher;
  private readonly installationId: () => string;
  private readonly now: () => Date;
  private operation?: { controller: AbortController; promise: Promise<ModelAssetStatus> };

  constructor(
    readonly rootDirectory: string,
    readonly manifest: ModelAssetManifest,
    private readonly store: ModelAssetStore,
    options: VerifiedModelAssetManagerOptions,
  ) {
    validateRootDirectory(rootDirectory);
    validateManifest(manifest);
    this.fetchAsset = options.fetchAsset;
    this.installationId = options.installationId ?? defaultInstallationId;
    this.now = options.now ?? (() => new Date());
  }

  get totalBytes(): number {
    return this.manifest.artifacts.reduce((sum, asset) => sum + asset.bytes, 0);
  }

  get modelDirectory(): string {
    return joinPath(this.rootDirectory, this.manifest.cacheKey);
  }

  get isInstalling(): boolean {
    return this.operation !== undefined;
  }

  async getStatus(verifyIntegrity = false): Promise<ModelAssetStatus> {
    const emptyStatus: ModelAssetStatus = {
      diskBytes: 0,
      expectedBytes: this.totalBytes,
      installedBytes: 0,
      state: 'not-installed',
    };
    if (!await this.store.exists(this.rootDirectory)) return emptyStatus;
    const diskBytes = await directorySize(this.store, this.rootDirectory);
    const statusWithDisk = { ...emptyStatus, diskBytes };
    if (!await this.store.exists(this.modelDirectory)) {
      return diskBytes > 0
        ? { ...statusWithDisk, reason: 'Existing files do not form a complete model for this release.', state: 'invalid' }
        : statusWithDisk;
    }

    const marker = await this.readMarker();
    if (!marker || marker.fingerprint !== manifestFingerprint(this.manifest)) {
      return { ...statusWithDisk, reason: 'The installed model record is missing or does not match this release.', state: 'invalid' };
    }

    for (const asset of this.manifest.artifacts) {
      const path = joinPath(this.modelDirectory, asset.path);
      const size = await this.store.size(path);
      if (size !== asset.bytes) {
        return { ...statusWithDisk, reason: `${asset.path} is missing or has the wrong size.`, state: 'invalid' };
      }
      if (verifyIntegrity) {
        const digest = await sha256Hex(await this.store.readBinary(path));
        if (digest !== asset.sha256) {
          return { ...statusWithDisk, reason: `${asset.path} failed its integrity check.`, state: 'invalid' };
        }
      }
    }

    return {
      diskBytes,
      expectedBytes: this.totalBytes,
      installedAt: marker.installedAt,
      installedBytes: marker.totalBytes,
      state: 'ready',
    };
  }

  install(onProgress?: (progress: ModelAssetProgress) => void): Promise<ModelAssetStatus> {
    if (this.operation) return this.operation.promise;

    const controller = new AbortController();
    const promise = this.performInstall(controller.signal, onProgress).finally(() => {
      if (this.operation?.promise === promise) this.operation = undefined;
    });
    this.operation = { controller, promise };
    return promise;
  }

  cancelInstall(): void {
    this.operation?.controller.abort();
  }

  /**
   * Reads the exact bytes used by the inference worker and verifies those same
   * buffers before returning them. This avoids a check-then-read race and never
   * performs a network request.
   */
  async readVerifiedArtifacts(): Promise<VerifiedModelArtifacts> {
    const marker = await this.readMarker();
    if (!marker || marker.fingerprint !== manifestFingerprint(this.manifest)) {
      throw new ModelAssetManagerError(
        'integrity',
        'The experimental model is not installed or does not match this ScottSearch release.',
      );
    }

    const artifacts = new Map<string, ArrayBuffer>();
    for (const asset of this.manifest.artifacts) {
      const path = joinPath(this.modelDirectory, asset.path);
      const size = await this.store.size(path);
      if (size !== asset.bytes) {
        throw new ModelAssetManagerError('integrity', `${asset.path} is missing or has the wrong size.`);
      }
      let data: ArrayBuffer;
      try {
        data = await this.store.readBinary(path);
      } catch (error) {
        throw new ModelAssetManagerError('storage', `Unable to read ${asset.path}: ${readableError(error)}`);
      }
      if (data.byteLength !== asset.bytes || await sha256Hex(data) !== asset.sha256) {
        throw new ModelAssetManagerError('integrity', `${asset.path} failed its integrity check.`);
      }
      artifacts.set(asset.path, data);
    }
    return artifacts;
  }

  async removeAll(): Promise<void> {
    const activeOperation = this.operation?.promise;
    this.cancelInstall();
    if (activeOperation) {
      try {
        await activeOperation;
      } catch {
        // Cancellation and failed downloads are expected before deletion.
      }
    }
    if (await this.store.exists(this.rootDirectory)) {
      await this.store.removeDirectory(this.rootDirectory);
    }
  }

  private async performInstall(
    signal: AbortSignal,
    onProgress?: (progress: ModelAssetProgress) => void,
  ): Promise<ModelAssetStatus> {
    const current = await this.getStatus(true);
    if (current.state === 'ready') return current;

    await ensureDirectory(this.store, this.rootDirectory);
    await this.removeStaleStagingDirectories();

    const id = this.installationId();
    if (!/^[a-zA-Z0-9_-]+$/u.test(id)) {
      throw new ModelAssetManagerError('storage', 'Unable to create a safe staging directory.');
    }
    const stagingDirectory = joinPath(this.rootDirectory, `.staging-${id}`);
    await ensureDirectory(this.store, stagingDirectory);

    let completedBytes = 0;
    try {
      for (let index = 0; index < this.manifest.artifacts.length; index += 1) {
        throwIfCancelled(signal);
        const asset = this.manifest.artifacts[index];
        if (!asset) continue;
        emitProgress(onProgress, {
          artifactCount: this.manifest.artifacts.length,
          artifactIndex: index,
          artifactPath: asset.path,
          completedBytes,
          phase: 'downloading',
          totalBytes: this.totalBytes,
        });

        const data = await this.fetchAsset(asset, {
          onProgress: (loadedBytes) => emitProgress(onProgress, {
            artifactCount: this.manifest.artifacts.length,
            artifactIndex: index,
            artifactPath: asset.path,
            completedBytes: completedBytes + Math.min(loadedBytes, asset.bytes),
            phase: 'downloading',
            totalBytes: this.totalBytes,
          }),
          signal,
        });
        throwIfCancelled(signal);
        if (data.byteLength !== asset.bytes) {
          throw new ModelAssetManagerError(
            'size',
            `${asset.path} was ${data.byteLength} bytes; expected ${asset.bytes}.`,
          );
        }

        emitProgress(onProgress, {
          artifactCount: this.manifest.artifacts.length,
          artifactIndex: index,
          artifactPath: asset.path,
          completedBytes: completedBytes + asset.bytes,
          phase: 'verifying',
          totalBytes: this.totalBytes,
        });
        const digest = await sha256Hex(data);
        if (digest !== asset.sha256) {
          throw new ModelAssetManagerError('integrity', `${asset.path} failed its SHA-256 integrity check.`);
        }
        throwIfCancelled(signal);

        const destination = joinPath(stagingDirectory, asset.path);
        await ensureDirectory(this.store, parentPath(destination));
        await this.store.writeBinary(destination, data);
        completedBytes += asset.bytes;
      }

      throwIfCancelled(signal);
      const marker: InstalledMarker = {
        fingerprint: manifestFingerprint(this.manifest),
        installedAt: this.now().toISOString(),
        schemaVersion: MARKER_SCHEMA_VERSION,
        totalBytes: this.totalBytes,
      };
      await this.store.writeBinary(
        joinPath(stagingDirectory, MARKER_FILENAME),
        encodeText(JSON.stringify(marker)),
      );

      emitProgress(onProgress, {
        artifactCount: this.manifest.artifacts.length,
        artifactIndex: this.manifest.artifacts.length,
        completedBytes,
        phase: 'activating',
        totalBytes: this.totalBytes,
      });
      throwIfCancelled(signal);

      if (await this.store.exists(this.modelDirectory)) {
        await this.store.removeDirectory(this.modelDirectory);
      }
      await this.store.rename(stagingDirectory, this.modelDirectory);
      return await this.getStatus(false);
    } catch (error) {
      await safeRemoveDirectory(this.store, stagingDirectory);
      if (signal.aborted || isAbortError(error)) {
        throw new ModelAssetManagerError('cancelled', 'The model download was cancelled.');
      }
      if (error instanceof ModelAssetManagerError) throw error;
      throw new ModelAssetManagerError('storage', readableError(error));
    }
  }

  private async readMarker(): Promise<InstalledMarker | null> {
    const markerPath = joinPath(this.modelDirectory, MARKER_FILENAME);
    if (!await this.store.exists(markerPath)) return null;
    try {
      const value = JSON.parse(new TextDecoder().decode(await this.store.readBinary(markerPath))) as Partial<InstalledMarker>;
      if (
        value.schemaVersion !== MARKER_SCHEMA_VERSION
        || typeof value.fingerprint !== 'string'
        || typeof value.installedAt !== 'string'
        || typeof value.totalBytes !== 'number'
      ) return null;
      return value as InstalledMarker;
    } catch {
      return null;
    }
  }

  private async removeStaleStagingDirectories(): Promise<void> {
    const directories = await this.store.listDirectories(this.rootDirectory);
    for (const directory of directories) {
      if (baseName(directory).startsWith('.staging-')) await safeRemoveDirectory(this.store, directory);
    }
  }
}

export function createRequestUrlModelAssetFetcher(
  requestUrl: ModelAssetRequestUrl,
): ModelAssetFetcher {
  let nativeRequest: Promise<ModelAssetRequestUrlResponse> | undefined;
  return async (asset, { signal, onProgress }) => {
    const output = new Uint8Array(asset.bytes);
    let offset = 0;
    while (offset < asset.bytes) {
      throwIfCancelled(signal);
      if (nativeRequest) {
        throw new ModelAssetManagerError(
          'network',
          'The previous native model request is still finishing. Wait before retrying.',
        );
      }

      const end = Math.min(offset + REQUEST_CHUNK_BYTES - 1, asset.bytes - 1);
      const expectedBytes = end - offset + 1;
      let response: ModelAssetRequestUrlResponse;
      try {
        const startedRequest = Promise.resolve(requestUrl({
          headers: { Range: `bytes=${offset}-${end}` },
          method: 'GET',
          throw: false,
          url: asset.url,
        }));
        const trackedRequest = startedRequest.finally(() => {
          if (nativeRequest === trackedRequest) nativeRequest = undefined;
        });
        nativeRequest = trackedRequest;
        response = await waitForRequestOrAbort(trackedRequest, signal);
      } catch (error) {
        if (signal.aborted || (error instanceof ModelAssetManagerError && error.code === 'cancelled')) throw error;
        throw new ModelAssetManagerError('network', `Unable to download ${asset.path}: ${readableError(error)}`);
      }

      throwIfCancelled(signal);
      validateRangeResponse(asset, response, offset, end, expectedBytes);
      output.set(new Uint8Array(response.arrayBuffer), offset);
      offset += expectedBytes;
      onProgress(offset);
    }
    return output.buffer;
  };
}

export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function formatModelBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${bytes} bytes`;
}

function validateManifest(manifest: ModelAssetManifest): void {
  if (!manifest.id.trim() || !manifest.displayName.trim() || !/^[a-f0-9]{40}$/u.test(manifest.revision)) {
    throw new ModelAssetManagerError('manifest', 'The model manifest identity is invalid.');
  }
  if (!/^[a-z0-9][a-z0-9._-]*$/u.test(manifest.cacheKey)) {
    throw new ModelAssetManagerError('manifest', 'The model cache key is invalid.');
  }
  if (manifest.license.name.trim() === '' || !isHttpsUrl(manifest.license.url)) {
    throw new ModelAssetManagerError('manifest', 'The model license record is invalid.');
  }
  if (manifest.artifacts.length === 0) {
    throw new ModelAssetManagerError('manifest', 'The model manifest has no artifacts.');
  }

  const paths = new Set<string>();
  let totalBytes = 0;
  for (const asset of manifest.artifacts) {
    if (!isSafeRelativePath(asset.path) || paths.has(asset.path)) {
      throw new ModelAssetManagerError('manifest', `Unsafe or duplicate model path: ${asset.path}.`);
    }
    if (!isHttpsUrl(asset.url)) {
      throw new ModelAssetManagerError('manifest', `Model URL must use HTTPS: ${asset.path}.`);
    }
    if (!Number.isSafeInteger(asset.bytes) || asset.bytes <= 0 || asset.bytes > MAX_ARTIFACT_BYTES) {
      throw new ModelAssetManagerError('manifest', `Model size is invalid: ${asset.path}.`);
    }
    if (!/^[a-f0-9]{64}$/u.test(asset.sha256)) {
      throw new ModelAssetManagerError('manifest', `Model digest is invalid: ${asset.path}.`);
    }
    paths.add(asset.path);
    totalBytes += asset.bytes;
  }
  if (totalBytes > MAX_MODEL_BYTES) {
    throw new ModelAssetManagerError('manifest', 'The model manifest exceeds the reviewed size limit.');
  }
}

function validateRootDirectory(path: string): void {
  if (!isSafeRelativePath(path)) {
    throw new ModelAssetManagerError('manifest', 'The model storage directory is unsafe.');
  }
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function isSafeRelativePath(path: string): boolean {
  return path.length > 0
    && !path.startsWith('/')
    && !path.includes('\\')
    && !containsControlCharacter(path)
    && path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
}

async function ensureDirectory(store: ModelAssetStore, path: string): Promise<void> {
  const segments = path.split('/');
  let current = '';
  for (const segment of segments) {
    current = current === '' ? segment : `${current}/${segment}`;
    if (!await store.exists(current)) await store.makeDirectory(current);
  }
}

async function directorySize(store: ModelAssetStore, root: string): Promise<number> {
  const pending = [root];
  let total = 0;
  while (pending.length > 0) {
    const directory = pending.pop();
    if (!directory) continue;
    pending.push(...await store.listDirectories(directory));
    for (const file of await store.listFiles(directory)) total += (await store.size(file)) ?? 0;
  }
  return total;
}

async function safeRemoveDirectory(store: ModelAssetStore, path: string): Promise<void> {
  try {
    if (await store.exists(path)) await store.removeDirectory(path);
  } catch {
    // Keep the original installation error. A later install removes stale staging directories.
  }
}

function manifestFingerprint(manifest: ModelAssetManifest): string {
  return [
    MARKER_SCHEMA_VERSION,
    manifest.id,
    manifest.revision,
    manifest.cacheKey,
    ...manifest.artifacts.map((asset) => `${asset.path}:${asset.bytes}:${asset.sha256}`),
  ].join('\n');
}

function emitProgress(
  listener: ((progress: ModelAssetProgress) => void) | undefined,
  progress: ModelAssetProgress,
): void {
  try {
    listener?.(progress);
  } catch {
    // UI progress must never break a verified download.
  }
}

function encodeText(text: string): ArrayBuffer {
  const bytes = new TextEncoder().encode(text);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new ModelAssetManagerError('cancelled', 'The model download was cancelled.');
}

function waitForRequestOrAbort<T>(request: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(new ModelAssetManagerError('cancelled', 'The model download was cancelled.'));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort);
      reject(new ModelAssetManagerError('cancelled', 'The model download was cancelled.'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    void request.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

function validateRangeResponse(
  asset: ModelAsset,
  response: ModelAssetRequestUrlResponse,
  start: number,
  end: number,
  expectedBytes: number,
): void {
  const completeSingleRequest = start === 0 && expectedBytes === asset.bytes;
  if (response.status !== 206 && !(response.status === 200 && completeSingleRequest)) {
    const detail = response.status >= 200 && response.status < 300
      ? 'the server did not honor the reviewed byte range'
      : `HTTP ${response.status}`;
    throw new ModelAssetManagerError('network', `Unable to download ${asset.path}: ${detail}.`);
  }
  if (response.status === 206) {
    const range = headerValue(response.headers, 'content-range');
    if (range !== `bytes ${start}-${end}/${asset.bytes}`) {
      throw new ModelAssetManagerError('size', `${asset.path} returned an unexpected byte range.`);
    }
  }
  const declaredLength = numericHeader(response.headers, 'content-length');
  if (declaredLength !== null && declaredLength !== expectedBytes) {
    throw new ModelAssetManagerError('size', `${asset.path} returned an unexpected byte count.`);
  }
  if (response.arrayBuffer.byteLength !== expectedBytes) {
    throw new ModelAssetManagerError('size', `${asset.path} returned an unexpected byte count.`);
  }
}

function numericHeader(headers: Record<string, string>, name: string): number | null {
  const value = headerValue(headers, name);
  if (value === undefined || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function headerValue(headers: Record<string, string>, name: string): string | undefined {
  return Object.entries(headers).find(([candidate]) => candidate.toLowerCase() === name)?.[1];
}

function isAbortError(error: unknown): boolean {
  return (typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'AbortError')
    || (error instanceof Error && error.name === 'AbortError');
}

function readableError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function defaultInstallationId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function joinPath(...parts: string[]): string {
  return parts.filter(Boolean).join('/');
}

function parentPath(path: string): string {
  const parts = path.split('/');
  parts.pop();
  return parts.join('/');
}

function baseName(path: string): string {
  return path.split('/').pop() ?? path;
}
