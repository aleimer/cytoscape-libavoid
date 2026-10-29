/// <reference path="./libavoid-js.d.ts" />
/*! cytoscape-libavoid uses libavoid-js (c) Vladyslav Hnatiuk and libavoid (c) Monash University,
 * both licensed under LGPL-2.1-or-later: https://github.com/Aksem/libavoid-js, https://github.com/mjwybrow/adaptagrams
 * See THIRD-PARTY-NOTICES.md and licenses/LGPL-2.1.txt of cytoscape-libavoid. */

// Loads the libavoid WebAssembly module.

import * as libavoidJs from 'libavoid-js';
import type { Avoid } from './api';
import { pluginMessage } from '../shared/errors';

interface AvoidLibLoader {
  load(wasmUrl?: string | undefined): Promise<void>;
  getInstance(): Avoid;
}

const { AvoidLib } = libavoidJs as unknown as { AvoidLib: AvoidLibLoader };

let loading: Promise<Avoid> | null = null;
let loadedUrl: string | undefined;

/** Loads the libavoid WebAssembly module once and caches the instance; later calls reuse it. */
export function loadLibavoid(wasmUrl?: string | undefined): Promise<Avoid> {
  if (loading && wasmUrl !== undefined && wasmUrl !== loadedUrl) {
    // the module is a singleton in libavoid-js, it cannot be loaded from a second URL
    console.warn(
      pluginMessage(`libavoid is already loaded from ${loadedUrl ?? 'the default URL'}, ignoring ${wasmUrl}`),
    );
  }
  if (!loading) {
    loadedUrl = wasmUrl;
    loading = AvoidLib.load(wasmUrl)
      .then(() => AvoidLib.getInstance())
      .catch((err: Error) => {
        loading = null; // allow a retry, e.g. with a corrected wasmUrl
        throw err;
      });
  }
  return loading;
}
