// Module declarations for the plugins used in the bench (none ship usable types).
// Kept free of top-level imports so these stay ambient declarations.

declare module 'cytoscape-grid-guide' {
  const register: (cy: typeof import('cytoscape')) => void;
  export default register;
}

declare module 'cytoscape-expand-collapse' {
  const register: (cy: typeof import('cytoscape')) => void;
  export default register;
}

declare module 'cytoscape-node-html-label' {
  const register: (cy: typeof import('cytoscape')) => void;
  export default register;
}
