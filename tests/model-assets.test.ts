import { describe, expect, it, vi } from 'vitest';

import {
  ARCTIC_EMBED_XS_INT8,
  ARCTIC_EMBED_XS_TOTAL_BYTES,
} from '../src/model-assets/manifest';
import {
  ModelAssetManagerError,
  createRequestUrlModelAssetFetcher,
  sha256Hex,
  VerifiedModelAssetManager,
  type ModelAsset,
  type ModelAssetFetcher,
  type ModelAssetManifest,
  type ModelAssetStore,
} from '../src/model-assets/verified-model-manager';

const encoder = new TextEncoder();

describe('reviewed model manifest', () => {
  it('locks every required artifact to the measured revision, size, and digest', () => {
    expect(ARCTIC_EMBED_XS_TOTAL_BYTES).toBe(23_686_811);
    expect(ARCTIC_EMBED_XS_INT8.revision).toBe('d8c86521100d3556476a063fc2342036d45c106f');
    expect(ARCTIC_EMBED_XS_INT8.artifacts).toEqual([
      expect.objectContaining({
        bytes: 737,
        path: 'config.json',
        sha256: 'd7d071046ab952af96b7abad788db7ab3fc997b465e1b9914ff39707092254ec',
      }),
      expect.objectContaining({
        bytes: 711_649,
        path: 'tokenizer.json',
        sha256: '91f1def9b9391fdabe028cd3f3fcc4efd34e5d1f08c3bf2de513ebb5911a1854',
      }),
      expect.objectContaining({
        bytes: 1_433,
        path: 'tokenizer_config.json',
        sha256: '9ca59277519f6e3692c8685e26b94d4afca2d5438deff66483db495e48735810',
      }),
      expect.objectContaining({
        bytes: 22_972_992,
        path: 'onnx/model_int8.onnx',
        sha256: 'e6aa5e656466a73d7c3111e9a3378bd13e5b93af30eaac2b3f13fd56692589a1',
      }),
    ]);
    expect(ARCTIC_EMBED_XS_INT8.artifacts.every(({ url }) =>
      url.startsWith(`https://huggingface.co/Snowflake/snowflake-arctic-embed-xs/resolve/${ARCTIC_EMBED_XS_INT8.revision}/`),
    )).toBe(true);
  });
});

describe('VerifiedModelAssetManager', () => {
  it('does no network work until install is explicitly called', async () => {
    const fixture = await createFixture();
    const fetchAsset = vi.fn(fixture.fetchAsset);
    const manager = createManager(fixture.store, fixture.manifest, fetchAsset);

    await expect(manager.getStatus()).resolves.toMatchObject({ state: 'not-installed' });
    expect(fetchAsset).not.toHaveBeenCalled();

    await manager.install();
    expect(fetchAsset).toHaveBeenCalledTimes(2);
  });

  it('verifies every artifact in staging before atomically activating the model', async () => {
    const fixture = await createFixture();
    const progress: string[] = [];
    const context: { manager?: VerifiedModelAssetManager } = {};
    const fetchAsset: ModelAssetFetcher = async (asset, options) => {
      expect(await fixture.store.exists(context.manager?.modelDirectory ?? '')).toBe(false);
      const data = fixture.data.get(asset.path);
      if (!data) throw new Error('Missing fixture data.');
      options.onProgress(data.byteLength);
      return copyBuffer(data);
    };
    const manager = createManager(fixture.store, fixture.manifest, fetchAsset);
    context.manager = manager;

    const status = await manager.install((event) => progress.push(`${event.phase}:${event.artifactPath ?? ''}`));

    expect(status).toMatchObject({ installedBytes: 11, state: 'ready' });
    expect(progress).toContain('verifying:config.json');
    expect(progress[progress.length - 1]).toBe('activating:');
    expect(fixture.store.renames).toEqual([
      ['plugins/scottsearch/model-assets/.staging-test-run', manager.modelDirectory],
    ]);
    expect(await manager.getStatus(true)).toMatchObject({ state: 'ready' });
    expect(fixture.store.paths().some((path) => path.includes('.staging-'))).toBe(false);

    await manager.install();
    expect(fixture.store.renames).toHaveLength(1);
  });

  it('rejects a digest mismatch and removes every staged byte', async () => {
    const fixture = await createFixture();
    const corrupt = encoder.encode('BAD!');
    const manager = createManager(fixture.store, fixture.manifest, async (asset, options) => {
      const data = asset.path === 'config.json' ? corrupt : fixture.data.get(asset.path);
      if (!data) throw new Error('Missing fixture data.');
      options.onProgress(data.byteLength);
      return copyBuffer(data);
    });

    await expect(manager.install()).rejects.toMatchObject({ code: 'integrity' });
    await expect(manager.getStatus()).resolves.toMatchObject({ state: 'not-installed' });
    expect(fixture.store.paths().some((path) => path.includes('.staging-'))).toBe(false);
  });

  it('rejects unexpected sizes before activation', async () => {
    const fixture = await createFixture();
    const manager = createManager(fixture.store, fixture.manifest, async () => encoder.encode('too long').buffer);

    await expect(manager.install()).rejects.toMatchObject({ code: 'size' });
    expect(await fixture.store.exists(manager.modelDirectory)).toBe(false);
  });

  it('cancels an active request and cleans its staging directory', async () => {
    const fixture = await createFixture();
    let signalDownloadStarted: (() => void) | undefined;
    const downloadStarted = new Promise<void>((resolve) => { signalDownloadStarted = resolve; });
    const manager = createManager(fixture.store, fixture.manifest, async (_asset, { signal }) => {
      signalDownloadStarted?.();
      return await new Promise<ArrayBuffer>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true });
      });
    });

    const installation = manager.install();
    await downloadStarted;
    manager.cancelInstall();

    await expect(installation).rejects.toMatchObject({ code: 'cancelled' });
    expect(manager.isInstalling).toBe(false);
    expect(fixture.store.paths().some((path) => path.includes('.staging-'))).toBe(false);
  });

  it('supports a clean retry after an interrupted download', async () => {
    const fixture = await createFixture();
    let failed = false;
    const manager = createManager(fixture.store, fixture.manifest, async (asset, options) => {
      if (!failed) {
        failed = true;
        throw new ModelAssetManagerError('network', 'Offline.');
      }
      const data = fixture.data.get(asset.path);
      if (!data) throw new Error('Missing fixture data.');
      options.onProgress(data.byteLength);
      return copyBuffer(data);
    });

    await expect(manager.install()).rejects.toMatchObject({ code: 'network' });
    await expect(manager.install()).resolves.toMatchObject({ state: 'ready' });
  });

  it('reports and removes staging data left by an interrupted process', async () => {
    const fixture = await createFixture();
    fixture.store.seed(
      'plugins/scottsearch/model-assets/.staging-crashed/partial.bin',
      encoder.encode('partial'),
    );
    const manager = createManager(fixture.store, fixture.manifest, fixture.fetchAsset);

    await expect(manager.getStatus()).resolves.toMatchObject({
      diskBytes: 7,
      reason: 'Existing files do not form a complete model for this release.',
      state: 'invalid',
    });
    await manager.install();

    expect(fixture.store.paths().some((path) => path.includes('.staging-crashed'))).toBe(false);
    await expect(manager.getStatus()).resolves.toMatchObject({ state: 'ready' });
  });

  it('leaves no usable or staged model after a storage failure', async () => {
    const fixture = await createFixture();
    fixture.store.nextWriteError = new Error('No space left on device.');
    const manager = createManager(fixture.store, fixture.manifest, fixture.fetchAsset);

    await expect(manager.install()).rejects.toMatchObject({
      code: 'storage',
      message: 'No space left on device.',
    });
    expect(await fixture.store.exists(manager.modelDirectory)).toBe(false);
    expect(fixture.store.paths().some((path) => path.includes('.staging-'))).toBe(false);
  });

  it('detects same-size corruption during a full integrity check', async () => {
    const fixture = await createFixture();
    const manager = createManager(fixture.store, fixture.manifest, fixture.fetchAsset);
    await manager.install();
    fixture.store.overwrite(
      `${manager.modelDirectory}/config.json`,
      encoder.encode('BAD!'),
    );

    await expect(manager.getStatus(false)).resolves.toMatchObject({ state: 'ready' });
    await expect(manager.getStatus(true)).resolves.toMatchObject({
      reason: 'config.json failed its integrity check.',
      state: 'invalid',
    });
  });

  it('returns only buffers that were fully verified at read time', async () => {
    const fixture = await createFixture();
    const manager = createManager(fixture.store, fixture.manifest, fixture.fetchAsset);
    await manager.install();

    const artifacts = await manager.readVerifiedArtifacts();
    expect([...artifacts.keys()]).toEqual(['config.json', 'onnx/model.onnx']);
    expect(new TextDecoder().decode(artifacts.get('config.json'))).toBe('good');

    fixture.store.overwrite(`${manager.modelDirectory}/config.json`, encoder.encode('BAD!'));
    await expect(manager.readVerifiedArtifacts()).rejects.toMatchObject({
      code: 'integrity',
      message: 'config.json failed its integrity check.',
    });
  });

  it('deletes only the dedicated model directory', async () => {
    const fixture = await createFixture();
    const manager = createManager(fixture.store, fixture.manifest, fixture.fetchAsset);
    fixture.store.seed('vault/Notes/Keep me.md', encoder.encode('note'));
    fixture.store.seed('plugins/scottsearch/data.json', encoder.encode('{}'));
    await manager.install();

    await manager.removeAll();

    expect(await fixture.store.exists('vault/Notes/Keep me.md')).toBe(true);
    expect(await fixture.store.exists('plugins/scottsearch/data.json')).toBe(true);
    expect(await fixture.store.exists(manager.rootDirectory)).toBe(false);
  });

  it('rejects unsafe paths and non-HTTPS manifests', async () => {
    const fixture = await createFixture();
    const unsafePath = { ...fixture.manifest, artifacts: [{ ...fixture.manifest.artifacts[0]!, path: '../escape' }] };
    const unsafeUrl = { ...fixture.manifest, artifacts: [{ ...fixture.manifest.artifacts[0]!, url: 'http://example.test/model' }] };

    expect(() => createManager(fixture.store, unsafePath, fixture.fetchAsset)).toThrow('Unsafe or duplicate');
    expect(() => createManager(fixture.store, unsafeUrl, fixture.fetchAsset)).toThrow('must use HTTPS');
  });
});

describe('createRequestUrlModelAssetFetcher', () => {
  it('uses the Obsidian request API and reports bytes only after the response returns', async () => {
    const bytes = encoder.encode('verified');
    const requestUrl = vi.fn(async () => requestResponse(bytes, 200, { 'Content-Length': String(bytes.byteLength) }));
    const progress: number[] = [];
    const asset = await assetFor('model.onnx', bytes);
    const fetchAsset = createRequestUrlModelAssetFetcher(requestUrl);

    const result = await fetchAsset(asset, {
      onProgress: (loaded) => progress.push(loaded),
      signal: new AbortController().signal,
    });

    expect(new TextDecoder().decode(result)).toBe('verified');
    expect(progress).toEqual([bytes.byteLength]);
    expect(requestUrl).toHaveBeenCalledWith({
      headers: { Range: `bytes=0-${bytes.byteLength - 1}` },
      method: 'GET',
      throw: false,
      url: asset.url,
    });
  });

  it('assembles validated one-mebibyte ranges and reports bounded progress', async () => {
    const bytes = new Uint8Array(1_048_579).fill(7);
    const asset = await assetFor('model.onnx', bytes);
    const requestUrl = vi.fn(async (request: { headers: Record<string, string> }) => {
      const match = /^bytes=(\d+)-(\d+)$/u.exec(request.headers.Range ?? '');
      if (!match) throw new Error('Missing byte range.');
      const start = Number(match[1]);
      const end = Number(match[2]);
      const part = bytes.slice(start, end + 1);
      return requestResponse(part, 206, {
        'CONTENT-LENGTH': String(part.byteLength),
        'Content-Range': `bytes ${start}-${end}/${bytes.byteLength}`,
      });
    });
    const progress: number[] = [];

    const result = await createRequestUrlModelAssetFetcher(requestUrl)(asset, {
      onProgress: (loaded) => progress.push(loaded),
      signal: new AbortController().signal,
    });

    expect(new Uint8Array(result)).toEqual(bytes);
    expect(requestUrl).toHaveBeenCalledTimes(2);
    expect(progress).toEqual([1_048_576, bytes.byteLength]);
  });

  it('rejects an HTTP failure', async () => {
    const expected = encoder.encode('tiny');
    const asset = await assetFor('model.onnx', expected);
    const fetchAsset = createRequestUrlModelAssetFetcher(async () => requestResponse(expected, 503));

    await expect(fetchAsset(asset, {
      onProgress: () => undefined,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'network', message: 'Unable to download model.onnx: HTTP 503.' });
  });

  it('rejects a case-insensitive declared size above the reviewed limit', async () => {
    const expected = encoder.encode('tiny');
    const asset = await assetFor('model.onnx', expected);
    const fetchAsset = createRequestUrlModelAssetFetcher(async () => requestResponse(
      expected,
      200,
      { 'CONTENT-LENGTH': String(expected.byteLength + 1) },
    ));

    await expect(fetchAsset(asset, {
      onProgress: () => undefined,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'size' });
  });

  it('rejects a partial response with the wrong content range', async () => {
    const bytes = new Uint8Array(1_048_577).fill(3);
    const asset = await assetFor('model.onnx', bytes);
    const firstPart = bytes.slice(0, 1_048_576);
    const fetchAsset = createRequestUrlModelAssetFetcher(async () => requestResponse(
      firstPart,
      206,
      {
        'content-length': String(firstPart.byteLength),
        'content-range': `bytes 1-1048576/${bytes.byteLength}`,
      },
    ));

    await expect(fetchAsset(asset, {
      onProgress: () => undefined,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'size', message: 'model.onnx returned an unexpected byte range.' });
  });

  it('does not start a request when already cancelled', async () => {
    const bytes = encoder.encode('verified');
    const asset = await assetFor('model.onnx', bytes);
    const requestUrl = vi.fn(async () => requestResponse(bytes));
    const controller = new AbortController();
    controller.abort();

    await expect(createRequestUrlModelAssetFetcher(requestUrl)(asset, {
      onProgress: () => undefined,
      signal: controller.signal,
    })).rejects.toMatchObject({ code: 'cancelled' });
    expect(requestUrl).not.toHaveBeenCalled();
  });

  it('returns cancellation promptly while a native request finishes in the background', async () => {
    const bytes = encoder.encode('verified');
    const asset = await assetFor('model.onnx', bytes);
    let finishRequest: ((response: ReturnType<typeof requestResponse>) => void) | undefined;
    const nativeRequest = new Promise<ReturnType<typeof requestResponse>>((resolve) => {
      finishRequest = resolve;
    });
    const requestUrl = vi.fn(() => nativeRequest);
    const fetchAsset = createRequestUrlModelAssetFetcher(requestUrl);
    const progress: number[] = [];
    const controller = new AbortController();
    const download = fetchAsset(asset, {
      onProgress: (loaded) => progress.push(loaded),
      signal: controller.signal,
    });

    expect(requestUrl).toHaveBeenCalledOnce();
    controller.abort();
    await expect(download).rejects.toMatchObject({ code: 'cancelled' });
    await expect(fetchAsset(asset, {
      onProgress: () => undefined,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({
      code: 'network',
      message: 'The previous native model request is still finishing. Wait before retrying.',
    });
    finishRequest?.(requestResponse(bytes));
    await nativeRequest;
    await Promise.resolve();
    await expect(fetchAsset(asset, {
      onProgress: () => undefined,
      signal: new AbortController().signal,
    })).resolves.toHaveProperty('byteLength', bytes.byteLength);
    expect(requestUrl).toHaveBeenCalledTimes(2);
    expect(progress).toEqual([]);
  });

  it('maps native request failures to a network error', async () => {
    const bytes = encoder.encode('verified');
    const asset = await assetFor('model.onnx', bytes);
    const fetchAsset = createRequestUrlModelAssetFetcher(async () => {
      throw new Error('Offline.');
    });

    await expect(fetchAsset(asset, {
      onProgress: () => undefined,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'network', message: 'Unable to download model.onnx: Offline.' });
  });
});

function requestResponse(
  bytes: Uint8Array<ArrayBuffer>,
  status = 200,
  headers: Record<string, string> = {},
): { arrayBuffer: ArrayBuffer; headers: Record<string, string>; status: number } {
  return { arrayBuffer: copyBuffer(bytes), headers, status };
}

async function createFixture(): Promise<{
  data: Map<string, Uint8Array<ArrayBuffer>>;
  fetchAsset: ModelAssetFetcher;
  manifest: ModelAssetManifest;
  store: MemoryModelAssetStore;
}> {
  const data = new Map<string, Uint8Array<ArrayBuffer>>([
    ['config.json', encoder.encode('good')],
    ['onnx/model.onnx', encoder.encode('weights')],
  ]);
  const artifacts = await Promise.all([...data].map(async ([path, bytes]) => assetFor(path, bytes)));
  return {
    data,
    fetchAsset: async (asset, options) => {
      const bytes = data.get(asset.path);
      if (!bytes) throw new Error('Missing fixture data.');
      options.onProgress(bytes.byteLength);
      return copyBuffer(bytes);
    },
    manifest: {
      artifacts,
      cacheKey: 'fixture-model-aaaaaaaaaaaa',
      displayName: 'Fixture model',
      id: 'example/fixture-model',
      license: { name: 'Apache License 2.0', url: 'https://example.test/license' },
      revision: 'a'.repeat(40),
    },
    store: new MemoryModelAssetStore(),
  };
}

async function assetFor(path: string, bytes: Uint8Array<ArrayBuffer>): Promise<ModelAsset> {
  return {
    bytes: bytes.byteLength,
    path,
    sha256: await sha256Hex(copyBuffer(bytes)),
    url: `https://example.test/${path}`,
  };
}

function createManager(
  store: ModelAssetStore,
  manifest: ModelAssetManifest,
  fetchAsset: ModelAssetFetcher,
): VerifiedModelAssetManager {
  return new VerifiedModelAssetManager('plugins/scottsearch/model-assets', manifest, store, {
    fetchAsset,
    installationId: () => 'test-run',
    now: () => new Date('2026-09-13T17:00:00.000Z'),
  });
}

function copyBuffer(bytes: Uint8Array<ArrayBuffer>): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

class MemoryModelAssetStore implements ModelAssetStore {
  readonly renames: Array<[string, string]> = [];
  nextWriteError?: Error;
  private readonly directories = new Set<string>();
  private readonly files = new Map<string, Uint8Array<ArrayBuffer>>();

  exists(path: string): Promise<boolean> {
    return Promise.resolve(this.directories.has(path) || this.files.has(path));
  }

  listDirectories(path: string): Promise<string[]> {
    return Promise.resolve([...this.directories].filter((candidate) => parent(candidate) === path));
  }

  listFiles(path: string): Promise<string[]> {
    return Promise.resolve([...this.files.keys()].filter((candidate) => parent(candidate) === path));
  }

  makeDirectory(path: string): Promise<void> {
    const directoryParent = parent(path);
    if (directoryParent && !this.directories.has(directoryParent)) {
      return Promise.reject(new Error(`Missing parent: ${directoryParent}`));
    }
    this.directories.add(path);
    return Promise.resolve();
  }

  readBinary(path: string): Promise<ArrayBuffer> {
    const data = this.files.get(path);
    if (!data) return Promise.reject(new Error(`Missing file: ${path}`));
    return Promise.resolve(copyBuffer(data));
  }

  rename(from: string, to: string): Promise<void> {
    if (!this.directories.has(from) || this.directories.has(to)) {
      return Promise.reject(new Error('Unsafe rename.'));
    }
    this.renames.push([from, to]);
    const sourceDirectories = [...this.directories].filter((path) => path === from || path.startsWith(`${from}/`));
    const sourceFiles = [...this.files].filter(([path]) => path.startsWith(`${from}/`));
    for (const path of sourceDirectories) this.directories.delete(path);
    for (const [path] of sourceFiles) this.files.delete(path);
    for (const path of sourceDirectories) this.directories.add(`${to}${path.slice(from.length)}`);
    for (const [path, data] of sourceFiles) this.files.set(`${to}${path.slice(from.length)}`, data);
    return Promise.resolve();
  }

  removeDirectory(path: string): Promise<void> {
    for (const directory of [...this.directories]) {
      if (directory === path || directory.startsWith(`${path}/`)) this.directories.delete(directory);
    }
    for (const file of [...this.files.keys()]) {
      if (file.startsWith(`${path}/`)) this.files.delete(file);
    }
    return Promise.resolve();
  }

  size(path: string): Promise<number | null> {
    return Promise.resolve(this.files.get(path)?.byteLength ?? null);
  }

  writeBinary(path: string, data: ArrayBuffer): Promise<void> {
    if (this.nextWriteError) {
      const error = this.nextWriteError;
      this.nextWriteError = undefined;
      return Promise.reject(error);
    }
    if (!this.directories.has(parent(path))) return Promise.reject(new Error(`Missing parent: ${parent(path)}`));
    this.files.set(path, new Uint8Array(data.slice(0)));
    return Promise.resolve();
  }

  overwrite(path: string, data: Uint8Array<ArrayBuffer>): void {
    if (!this.files.has(path)) throw new Error(`Missing file: ${path}`);
    this.files.set(path, data);
  }

  paths(): string[] {
    return [...this.directories, ...this.files.keys()].sort();
  }

  seed(path: string, data: Uint8Array<ArrayBuffer>): void {
    const segments = path.split('/');
    segments.pop();
    let current = '';
    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment;
      this.directories.add(current);
    }
    this.files.set(path, data);
  }
}

function parent(path: string): string {
  const parts = path.split('/');
  parts.pop();
  return parts.join('/');
}
