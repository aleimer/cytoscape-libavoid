// Layering of src/, checked by `npm run deps:check` (see scripts/deps.ts).
// Dependencies point one way: cytoscape-adapter -> worker -> routing ->
// postprocess -> libavoid -> shared; only the adapter knows Cytoscape.

/** A rule that `from` must not import `to`; both are path patterns. */
const forbid = (name, comment, from, to) => ({
  name,
  comment,
  severity: 'error',
  from: { path: from },
  to: { path: to },
});

module.exports = {
  forbidden: [
    { name: 'no-circular', severity: 'error', from: {}, to: { circular: true } },
    forbid(
      'shared-is-the-base',
      'geometry, graph and errors are used by all layers',
      '^src/shared/',
      '^src/(?!shared/)',
    ),
    forbid(
      'graph-only-geometry',
      'the graph model only builds on geometry',
      '^src/shared/graph\\.ts$',
      '^src/shared/(?!geometry\\.ts$)',
    ),
    forbid('geometry-is-a-leaf', 'plain geometry', '^src/shared/geometry\\.ts$', '^src/'),
    forbid('errors-is-a-leaf', 'messages and option checks', '^src/shared/errors\\.ts$', '^src/'),
    forbid(
      'libavoid-below-routing',
      'the libavoid wrapper only needs the shared base',
      '^src/libavoid/',
      '^src/(cytoscape-adapter|routing|postprocess|worker)/',
    ),
    forbid(
      'postprocess-below-routing',
      'post-processing is used by routing, not the other way',
      '^src/postprocess/',
      '^src/(cytoscape-adapter|routing|worker|libavoid)/',
    ),
    forbid(
      'routing-without-adapter',
      'routing runs in Node and in the worker',
      '^src/routing/',
      '^src/(cytoscape-adapter|worker)/',
    ),
    forbid(
      'worker-without-adapter',
      'the worker side knows nothing about Cytoscape',
      '^src/worker/',
      '^src/cytoscape-adapter/',
    ),
    {
      name: 'cytoscape-only-in-adapter',
      comment: 'everything but the adapter works without Cytoscape',
      severity: 'error',
      from: { path: '^src/', pathNot: '^src/(cytoscape-adapter/|index\\.ts$)' },
      to: { path: '(^|/)node_modules/cytoscape/' },
    },
  ],
  options: {
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true, // `import type` counts as well
    doNotFollow: { path: 'node_modules' },
  },
};
