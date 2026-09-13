import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ON_DEVICE_RUNTIME_GLUE_SHA256,
  ON_DEVICE_RUNTIME_VERSION,
  ON_DEVICE_RUNTIME_WASM_BYTES,
  ON_DEVICE_RUNTIME_WASM_SHA256,
} from '../src/on-device/runtime-metadata';

const require = createRequire(import.meta.url);
const wasmPath = require.resolve('onnxruntime-web/ort-wasm-simd-threaded.wasm');
const distributionDirectory = dirname(wasmPath);
const packageDirectory = resolve(distributionDirectory, '..');

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  license?: string;
  version?: string;
}

describe('reviewed browser runtime assets', () => {
  it('pins ONNX Runtime Web as an audited production dependency', () => {
    const project = readJson<PackageJson>(resolve(import.meta.dirname, '../package.json'));
    const runtimePackage = readJson<PackageJson>(resolve(packageDirectory, 'package.json'));

    expect(project.dependencies?.['onnxruntime-web']).toBe('1.29.0');
    expect(project.devDependencies?.['onnxruntime-web']).toBeUndefined();
    expect(runtimePackage.version).toBe('1.29.0');
    expect(runtimePackage.license).toBe('MIT');
    expect(ON_DEVICE_RUNTIME_VERSION).toBe('onnxruntime-web@1.29.0');
  });

  it('matches the exact reviewed glue module and single WASM binary', () => {
    const glue = readFileSync(resolve(distributionDirectory, 'ort.wasm.bundle.min.mjs'));
    const wasm = readFileSync(wasmPath);

    expect(glue.byteLength).toBe(72_894);
    expect(sha256(glue)).toBe(ON_DEVICE_RUNTIME_GLUE_SHA256);
    expect(wasm.byteLength).toBe(ON_DEVICE_RUNTIME_WASM_BYTES);
    expect(sha256(wasm)).toBe(ON_DEVICE_RUNTIME_WASM_SHA256);
  });
});

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function sha256(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}
