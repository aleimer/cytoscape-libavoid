/// <reference path="./libavoid-js.d.ts" />
/*! cytoscape-libavoid uses libavoid-js (c) Vladyslav Hnatiuk and libavoid (c) Monash University,
 * both licensed under LGPL-2.1-or-later: https://github.com/Aksem/libavoid-js, https://github.com/mjwybrow/adaptagrams
 * See THIRD-PARTY-NOTICES.md and licenses/LGPL-2.1.txt of cytoscape-libavoid. */

// Loads the libavoid WebAssembly module.

import * as libavoidJs from 'libavoid-js';
import { pluginMessage } from '../shared/errors';
import type { Avoid } from './api';

/** What libavoid-js exports; its own typings say `any`, see api.ts. */
interface AvoidLibLoader
{
  load(wasmUrl?: string | undefined): Promise<void>;
  getInstance(): Avoid;
}

const AVOID_LIB = (libavoidJs as unknown as { AvoidLib: AvoidLibLoader; }).AvoidLib;

/** The load in progress or done, shared by all callers; null before the first call and after a failed one. */
let loading: Promise<Avoid> | null = null;
let loadedUrl: string | undefined;

/**
 * Loads the libavoid WebAssembly module once and caches the instance; later calls reuse it.
 *
 * @param wasmUrl where the app serves libavoid.wasm; not needed in Node.js. Only the first call uses it.
 */
export function loadLibavoid(wasmUrl?: string | undefined): Promise<Avoid>
{
  if (loading && wasmUrl !== undefined && wasmUrl !== loadedUrl)
  {
    // the module is a singleton in libavoid-js, it cannot be loaded from a second URL
    console.warn(
      pluginMessage(`libavoid is already loaded from ${loadedUrl ?? 'the default URL'}, ignoring ${wasmUrl}`),
    );
  }
  if (!loading)
  {
    loadedUrl = wasmUrl;
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
