// Copies the TypeScript plugin from ../../src into src/app/cytoscape-libavoid/,
// the way another code base would use it.
import { cp, rm } from 'node:fs/promises';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const repo = join(root, '../..');
const target = join(root, 'src/app/cytoscape-libavoid');

await rm(target, { recursive: true, force: true });
await cp(join(repo, 'src'), target, { recursive: true });
console.log('copied src -> src/app/cytoscape-libavoid/');
