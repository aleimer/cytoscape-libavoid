// Entry for the single-file build: libavoid.wasm is inlined as a data: URL, so
// nothing besides this one file has to be served. Browser only; ~4/3 the wasm size.
import wasmUrl from 'virtual:libavoid-wasm';
import { defaults } from './index.ts';

defaults.wasmUrl = wasmUrl;

export * from './index.ts';
export { default } from './index.ts';
