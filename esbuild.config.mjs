import esbuild from 'esbuild';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { builtinModules, createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { gzipSync } from 'fflate';

const mode = process.argv[2] ?? 'development-experiment';
const mobileLab = mode === 'mobile-lab';
const desktopLab = mode === 'desktop-lab';
const labDirectory = mobileLab
  ? 'research/mobile-on-device-lab/dist'
  : desktopLab
    ? 'research/desktop-on-device-lab/dist'
    : undefined;
const production = mode === 'production' || mode === 'production-experiment' || labDirectory !== undefined;
const includeOnDeviceExperiment = mode !== 'production';
if (labDirectory) mkdirSync(labDirectory, { recursive: true });
const require = createRequire(import.meta.url);

let embeddedWorkerPlugin;
let workerSummary;

const disabledWorkerPlugin = {
  name: 'scottsearch-disabled-worker',
  setup(build) {
    build.onResolve({ filter: /^scottsearch:on-device-worker-source$/ }, () => ({
      namespace: 'scottsearch-disabled-worker',
      path: 'on-device-worker-source',
    }));
    build.onLoad({ filter: /.*/, namespace: 'scottsearch-disabled-worker' }, () => ({
      contents: 'export default "";',
      loader: 'js',
    }));
  },
};

if (includeOnDeviceExperiment) {
  const runtimePath = require.resolve('onnxruntime-web/ort-wasm-simd-threaded.wasm');
  const runtimeGluePath = resolve(dirname(runtimePath), 'ort.wasm.bundle.min.mjs');
  const runtimeBytes = readFileSync(runtimePath);
  const runtimeGlueBytes = readFileSync(runtimeGluePath);
  const reviewedRuntimeDigest = 'ec8580a9d7b9476ceee52e10a7f94124e4dc71a019d666ed6d4726697c109a4d';
  const reviewedRuntimeGlueDigest = '7a3913dc5c7a9c3ad1144f5fbfecd402bc5013bcc886bc67664b18d8a15ab298';
  const runtimeDigest = createHash('sha256').update(runtimeBytes).digest('hex');
  const runtimeGlueDigest = createHash('sha256').update(runtimeGlueBytes).digest('hex');
  if (runtimeDigest !== reviewedRuntimeDigest || runtimeGlueDigest !== reviewedRuntimeGlueDigest) {
    throw new Error(`Refusing to bundle unreviewed ONNX Runtime Web bytes: ${runtimeDigest}/${runtimeGlueDigest}.`);
  }
  const runtimeGzipBase64 = Buffer.from(gzipSync(runtimeBytes, { level: 9, mtime: 0 })).toString('base64');

  const runtimeLicense = `/*!
ONNX Runtime Web 1.29.0
Copyright (c) Microsoft Corporation. All rights reserved.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/`;
  const workerNetworkGuard = `
function scottsearchRejectWorkerNetworkRequest() {
  return Promise.reject(new Error("ScottSearch worker network access is disabled; verified model and runtime bytes must be supplied by the plugin."));
}`;

  const embeddedRuntimePlugin = {
    name: 'scottsearch-embedded-runtime',
    setup(build) {
      build.onResolve({ filter: /^scottsearch:ort-wasm-gzip-base64$/ }, () => ({
        namespace: 'scottsearch-runtime',
        path: 'ort-wasm-gzip-base64',
      }));
      build.onLoad({ filter: /.*/, namespace: 'scottsearch-runtime' }, () => ({
        contents: `export default ${JSON.stringify(runtimeGzipBase64)};`,
        loader: 'js',
      }));
    },
  };

  const workerBuild = await esbuild.build({
    banner: { js: `${runtimeLicense}\n${workerNetworkGuard}` },
    bundle: true,
    define: { fetch: 'scottsearchRejectWorkerNetworkRequest' },
    entryPoints: ['src/on-device/worker.ts'],
    format: 'iife',
    legalComments: 'none',
    logLevel: 'silent',
    metafile: true,
    minify: true,
    platform: 'browser',
    plugins: [embeddedRuntimePlugin],
    target: 'es2021',
    treeShaking: true,
    write: false,
  });
  const workerSource = workerBuild.outputFiles[0]?.text;
  if (!workerSource) throw new Error('Unable to build the on-device embedding worker.');
  const workerInputs = Object.keys(workerBuild.metafile.inputs).sort();
  const unreviewedWorkerInput = workerInputs.find((path) => (
    path.startsWith('node_modules/')
    && !path.startsWith('node_modules/onnxruntime-common/')
    && !path.startsWith('node_modules/onnxruntime-web/')
  ));
  if (unreviewedWorkerInput) {
    throw new Error(`Refusing to bundle unreviewed worker dependency: ${unreviewedWorkerInput}.`);
  }
  const runtimeModuleInputs = workerInputs.filter((path) => path.startsWith('node_modules/'));
  if (runtimeModuleInputs.length !== 1 || !runtimeModuleInputs[0]?.endsWith('/onnxruntime-web/dist/ort.wasm.bundle.min.mjs')) {
    throw new Error(`The worker runtime input set changed: ${runtimeModuleInputs.join(', ')}.`);
  }
  if (mode === 'worker-harness') {
    mkdirSync('research/on-device-embeddings/dist', { recursive: true });
    writeFileSync('research/on-device-embeddings/dist/scottsearch-worker.js', workerSource);
    console.log(`Wrote reviewed ${(Buffer.byteLength(workerSource) / 1_000_000).toFixed(1)} MB worker harness from ${workerInputs.length} audited inputs.`);
    console.log(workerInputs.join('\n'));
    process.exit(0);
  }

  embeddedWorkerPlugin = {
    name: 'scottsearch-embedded-worker',
    setup(build) {
      build.onResolve({ filter: /^scottsearch:on-device-worker-source$/ }, () => ({
        namespace: 'scottsearch-worker',
        path: 'on-device-worker-source',
      }));
      build.onLoad({ filter: /.*/, namespace: 'scottsearch-worker' }, () => ({
        contents: `export default ${JSON.stringify(workerSource)};`,
        loader: 'js',
        watchFiles: [
          runtimePath,
          'src/on-device/bert-tokenizer.ts',
          'src/on-device/embedding-core.ts',
          'src/on-device/protocol.ts',
          'src/on-device/runtime-metadata.ts',
          'src/on-device/worker.ts',
        ],
      }));
    },
  };
  workerSummary = `Reviewed on-device worker: ${(Buffer.byteLength(workerSource) / 1_000_000).toFixed(1)} MB embedded (${runtimeDigest.slice(0, 12)}…).`;
}

const context = await esbuild.context({
  banner: {
    js: '/* ScottSearch for Obsidian — generated bundle. Source: https://github.com/c4g-john/scottsearch-for-obsidian */',
  },
  bundle: true,
  define: {
    SCOTTSEARCH_DESKTOP_ON_DEVICE_LAB: JSON.stringify(desktopLab),
    SCOTTSEARCH_MOBILE_ON_DEVICE_LAB: JSON.stringify(mobileLab),
    SCOTTSEARCH_ON_DEVICE_EXPERIMENT: JSON.stringify(includeOnDeviceExperiment),
  },
  entryPoints: ['src/main.ts'],
  external: [
    'obsidian',
    'electron',
    '@codemirror/autocomplete',
    '@codemirror/collab',
    '@codemirror/commands',
    '@codemirror/language',
    '@codemirror/lint',
    '@codemirror/search',
    '@codemirror/state',
    '@codemirror/view',
    '@lezer/common',
    '@lezer/highlight',
    '@lezer/lr',
    ...builtinModules,
  ],
  format: 'cjs',
  logLevel: 'info',
  minify: production,
  outfile: labDirectory ? `${labDirectory}/main.js` : 'main.js',
  plugins: [embeddedWorkerPlugin ?? disabledWorkerPlugin],
  sourcemap: production ? false : 'inline',
  target: 'es2021',
  treeShaking: true,
});

console.log(workerSummary ?? 'Release-safe build: the unreleased on-device experiment is excluded.');
if (production) {
  await context.rebuild();
  await context.dispose();
  if (labDirectory) {
    const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
    const labManifest = mobileLab
      ? {
          description: 'Unreleased synthetic-vault test build for ScottSearch mobile model research.',
          id: 'scottsearch-mobile-lab',
          isDesktopOnly: false,
          name: 'ScottSearch Mobile Lab',
        }
      : {
          description: 'Unreleased synthetic-vault test build for ScottSearch desktop model research.',
          id: 'scottsearch-desktop-lab',
          isDesktopOnly: true,
          name: 'ScottSearch Desktop Lab',
        };
    writeFileSync(`${labDirectory}/manifest.json`, `${JSON.stringify({
      ...manifest,
      ...labManifest,
    }, null, 2)}\n`);
    copyFileSync('styles.css', `${labDirectory}/styles.css`);
    copyFileSync(`${labDirectory.replace(/\/dist$/u, '')}/README.md`, `${labDirectory}/SAFETY_NOTICE.md`);
    copyFileSync(`${labDirectory.replace(/\/dist$/u, '')}/EXPECTED_SHA256`, `${labDirectory}/EXPECTED_SHA256`);
    console.log(`Wrote the non-public ${mobileLab ? 'mobile' : 'desktop'} lab to ${labDirectory}.`);
  }
} else {
  await context.watch();
}
