# Third-party notices

cytoscape-libavoid itself is licensed under the MIT License (see `LICENSE`).
It uses the following third-party software, which keeps its own license. The
repository contains no copy of it; it is installed from npm and bundled by the
app that uses the plugin (here: the demo build in `demo/build/`).

## libavoid-js

- Used in: the JavaScript bindings bundled into an app that imports the plugin, and `libavoid.wasm`
- Version: 0.5.0-beta.5
- Copyright (c) Vladyslav Hnatiuk and contributors
- License: GNU Lesser General Public License v2.1 or later (LGPL-2.1-or-later), see `licenses/LGPL-2.1.txt`
- Source: https://github.com/Aksem/libavoid-js

## libavoid (Adaptagrams)

- Used in: `libavoid.wasm` (compiled to WebAssembly by libavoid-js)
- Version: Adaptagrams fork https://github.com/Aksem/adaptagrams, tag v1.0.4, patched by the libavoid-js build (`tools/generate.py`)
- Copyright (C) Monash University (e.g. "2004-2009" in libavoid.h); authors Michael Wybrow, Tim Dwyer, Steve Kieffer and contributors
- License: GNU Lesser General Public License v2.1 or later (LGPL-2.1-or-later), see `licenses/LGPL-2.1.txt`
- Source: https://github.com/mjwybrow/adaptagrams

## Emscripten runtime

- Used in: the libavoid-js JavaScript glue code
- License: MIT / University of Illinois NCSA Open Source License
- Source: https://github.com/emscripten-core/emscripten

## Cytoscape.js

- Used in: `demo/build/main.js` (demo only; the plugin itself does not include Cytoscape)
- Copyright (c) 2016-2026, The Cytoscape Consortium
- License: MIT, see `licenses/cytoscape-MIT.txt`
- Source: https://github.com/cytoscape/cytoscape.js

## Replacing libavoid

As required by the LGPL, you may replace or modify libavoid / libavoid-js: the
plugin source (`src/`) is included, and libavoid-js is a normal
npm dependency, so an app can be rebuilt against a modified libavoid-js
(`npm install <your libavoid-js>` followed by the app's build). `libavoid.wasm`
is loaded as a separate file at runtime.
