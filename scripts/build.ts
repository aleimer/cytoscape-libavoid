import { build } from 'esbuild';
import type { BuildOptions } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
// libavoid-js does not export its package.json; its main file sits in dist/
const libavoidDist = dirname(require.resolve('libavoid-js'));

await mkdir('dist', { recursive: true });
// The bundles contain libavoid-js (LGPL); the notice must survive minification by downstream builds.
const banner = {
  js: `/*! cytoscape-libavoid ${process.env.npm_package_version || ''} | bundles libavoid-js (c) Vladyslav Hnatiuk and libavoid (c) Monash University,
 * both licensed under LGPL-2.1-or-later: https://github.com/Aksem/libavoid-js, https://github.com/mjwybrow/adaptagrams
 * See THIRD-PARTY-NOTICES.md and licenses/LGPL-2.1.txt. */`,
};
const common: BuildOptions = {
  // ignore tsconfig.json: its `paths` entry points libavoid-js at a type-only stub
  tsconfigRaw: { compilerOptions: { verbatimModuleSyntax: true } },
  bundle: true, sourcemap: true, target: 'es2020', platform: 'browser', logLevel: 'info',
  banner,
};

await build({ ...common, entryPoints: ['src/index.ts'], format: 'esm', outfile: 'dist/cytoscape-libavoid.esm.js' });
await build({
  ...common,
  entryPoints: ['src/umd.ts'],
  format: 'iife',
  globalName: 'cytoscapeLibavoid',
  footer: { js: 'cytoscapeLibavoid = cytoscapeLibavoid.default;' },
  outfile: 'dist/cytoscape-libavoid.umd.js',
  // import.meta.url is meaningless in a classic script; src/index.ts falls back to document.currentScript
  define: { 'import.meta.url': 'undefined' },
});
// Single file for quick testing: ESM with libavoid.wasm inlined, no wasmUrl needed.
await build({
  ...common,
  entryPoints: ['src/standalone.ts'],
  format: 'esm',
  outfile: 'dist/cytoscape-libavoid.standalone.js',
  loader: { '.wasm': 'dataurl' },
  plugins: [{
    name: 'libavoid-wasm',
    setup(b) {
      b.onResolve({ filter: /^virtual:libavoid-wasm$/ }, () => ({ path: join(libavoidDist, 'libavoid.wasm') }));
    },
  }],
});
await copyFile(join(libavoidDist, 'libavoid.wasm'), 'dist/libavoid.wasm');
console.log('copied libavoid.wasm -> dist/');
