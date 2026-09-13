import { build } from 'esbuild';
import { resolve } from 'node:path';

const verify = !process.argv.includes('--no-verify');
const result = await build({
  bundle: true,
  entryPoints: [resolve('benchmarks/scale-benchmark.ts')],
  format: 'esm',
  logLevel: 'silent',
  platform: 'node',
  target: 'node22',
  write: false,
});
const output = result.outputFiles[0];
if (!output) throw new Error('Scale benchmark bundle was not produced.');

const moduleUrl = `data:text/javascript;base64,${Buffer.from(output.contents).toString('base64')}`;
const { runScaleBenchmark } = await import(moduleUrl);
const report = runScaleBenchmark({ verify });
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
