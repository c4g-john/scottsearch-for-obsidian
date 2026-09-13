import { normalizePath, type DataAdapter } from 'obsidian';

import type { ModelAssetStore } from './verified-model-manager';

export class ObsidianModelAssetStore implements ModelAssetStore {
  constructor(private readonly adapter: DataAdapter) {}

  exists(path: string): Promise<boolean> {
    return this.adapter.exists(normalizePath(path));
  }

  async listDirectories(path: string): Promise<string[]> {
    if (!await this.exists(path)) return [];
    return (await this.adapter.list(normalizePath(path))).folders;
  }

  async listFiles(path: string): Promise<string[]> {
    if (!await this.exists(path)) return [];
    return (await this.adapter.list(normalizePath(path))).files;
  }

  makeDirectory(path: string): Promise<void> {
    return this.adapter.mkdir(normalizePath(path));
  }

  readBinary(path: string): Promise<ArrayBuffer> {
    return this.adapter.readBinary(normalizePath(path));
  }

  rename(from: string, to: string): Promise<void> {
    return this.adapter.rename(normalizePath(from), normalizePath(to));
  }

  async removeDirectory(path: string): Promise<void> {
    await this.adapter.rmdir(normalizePath(path), true);
  }

  async size(path: string): Promise<number | null> {
    const stat = await this.adapter.stat(normalizePath(path));
    return stat?.type === 'file' ? stat.size : null;
  }

  writeBinary(path: string, data: ArrayBuffer): Promise<void> {
    return this.adapter.writeBinary(normalizePath(path), data);
  }
}
