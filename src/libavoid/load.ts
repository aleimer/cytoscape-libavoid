/// <reference path="./libavoid-js.d.ts" />
/*! cytoscape-libavoid uses libavoid-js (c) Vladyslav Hnatiuk and libavoid (c) Monash University,
 * both licensed under LGPL-2.1-or-later: https://github.com/Aksem/libavoid-js, https://github.com/mjwybrow/adaptagrams
 * See THIRD-PARTY-NOTICES.md and licenses/LGPL-2.1.txt of cytoscape-libavoid. */

/** Loads the libavoid WebAssembly module, once per page. */

import * as libavoidJs from 'libavoid-js';
import { pluginMessage } from '../shared/errors';
import type { Avoid } from './api';

/** What libavoid-js exports; its own typings say `any`, see api.ts. */
interface AvoidLibLoader
{
  /**
   * Fetches and compiles the WebAssembly module.
   *
   * @param wasmUrl where libavoid.wasm is served; libavoid-js's default if left out
   */
  load(wasmUrl?: string | undefined): Promise<void>;
  /** @returns the instance; only after {@link AvoidLibLoader.load} has resolved */
  getInstance(): Avoid;
}

/** libavoid-js's loader, a singleton: the module can only be loaded once per page. */
const AVOID_LIB = (libavoidJs as unknown as { AvoidLib: AvoidLibLoader; }).AvoidLib;

/** The load in progress or done, shared by all callers; null before the first call and after a failed one. */
let loading: Promise<Avoid> | null = null;
/** The wasmUrl {@link loading} uses; undefined = libavoid-js's default. */
let url: string | undefined;

/**
 * Loads the libavoid WebAssembly module once and caches the instance; later calls
 * reuse it. A failed load is retried on the next call.
 *
 * @param wasmUrl where the app serves libavoid.wasm; not needed in Node.js. Only the
 *   first call uses it; a different URL later is ignored with a console warning.
 * @returns the initialised instance
 */
export function loadLibavoid(wasmUrl?: string | undefined): Promise<Avoid>
{
  if (loading && wasmUrl !== undefined && wasmUrl !== url)
  {
    // the module is a singleton in libavoid-js, it cannot be loaded from a second URL
    console.warn(
      pluginMessage(`libavoid uses ${url ?? 'the default URL'}, ignoring ${wasmUrl}`),
    );
  }
  if (!loading)
  {
    url = wasmUrl;
    loading = AVOID_LIB.load(wasmUrl)
      .then(() => AVOID_LIB.getInstance())
      .catch((err: Error) =>
      {
        loading = null; // allow a retry, e.g. with a corrected wasmUrl
        throw err;
      });
  }
  return loading;
}
