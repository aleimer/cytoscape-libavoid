# Third-party notices

cytoscape-libavoid itself is licensed under the MIT License (see `LICENSE`).
It includes or uses the following third-party software, which keeps its own license.

## libavoid-js

- Used in: `dist/cytoscape-libavoid.esm.js`, `dist/cytoscape-libavoid.umd.js` (bundled JavaScript bindings), `dist/libavoid.wasm`
- Version: 0.5.0-beta.5
- Copyright (c) Vladyslav Hnatiuk and contributors
- License: GNU Lesser General Public License v2.1 or later (LGPL-2.1-or-later), see `licenses/LGPL-2.1.txt`
- Source: https://github.com/Aksem/libavoid-js

## libavoid (Adaptagrams)

- Used in: `dist/libavoid.wasm` (compiled to WebAssembly by libavoid-js)
- Version: Adaptagrams fork https://github.com/Aksem/adaptagrams, tag v1.0.4, patched by the libavoid-js build (`tools/generate.py`)
- Copyright (C) Monash University (e.g. "2004-2009" in libavoid.h); authors Michael Wybrow, Tim Dwyer, Steve Kieffer and contributors
- License: GNU Lesser General Public License v2.1 or later (LGPL-2.1-or-later), see `licenses/LGPL-2.1.txt`
- Source: https://github.com/mjwybrow/adaptagrams

## Emscripten runtime

- Used in: the libavoid-js JavaScript glue code inside `dist/*.js`
- License: MIT / University of Illinois NCSA Open Source License
- Source: https://github.com/emscripten-core/emscripten

## Cytoscape.js

- Used in: `demo/vendor/cytoscape.min.js` (demo only; the plugin itself does not bundle Cytoscape)
- Copyright (c) 2016-2026, The Cytoscape Consortium
- License: MIT, see `licenses/cytoscape-MIT.txt`
- Source: https://github.com/cytoscape/cytoscape.js

## Replacing libavoid

As required by the LGPL, you may replace or modify libavoid / libavoid-js:
the plugin source (`src/`) and build script (`scripts/build.ts`) are included,
so the bundles can be rebuilt against a modified libavoid-js (`npm install
<your libavoid-js>` followed by `npm run build`). `libavoid.wasm` is loaded as a
separate file at runtime.
