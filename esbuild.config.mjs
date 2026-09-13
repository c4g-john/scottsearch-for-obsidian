import esbuild from 'esbuild';
import process from 'node:process';
import { builtinModules } from 'node:module';

const production = process.argv[2] === 'production';

const context = await esbuild.context({
  banner: {
    js: `/* ScottSearch for Obsidian — generated bundle. Source: https://github.com/c4g-john/scottsearch-for-obsidian */`,
  },
  bundle: true,
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
  outfile: 'main.js',
  sourcemap: production ? false : 'inline',
  target: 'es2021',
  treeShaking: true,
});

if (production) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
