// Bundles demo/main.ts (which imports src) into
// demo/build/ and copies libavoid.wasm next to it.
import { build } from 'esbuild';
import { copyFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

await build({
  entryPoints: ['demo/main.ts'],
  outdir: 'demo/build',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  sourcemap: true,
  minify: true,
  logLevel: 'info',
});

// libavoid-js does not export its package.json; its main file sits in dist/ next to the wasm
const libavoidDist = dirname(createRequire(import.meta.url).resolve('libavoid-js'));
await copyFile(join(libavoidDist, 'libavoid.wasm'), 'demo/build/libavoid.wasm');
console.log('copied libavoid.wasm -> demo/build/');
