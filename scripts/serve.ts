// Minimal static server for the demo (the .wasm cannot be loaded from file://).
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const root = process.cwd();
const types: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.wasm': 'application/wasm',
  '.map': 'application/json',
  '.css': 'text/css',
};
const port = Number(process.env['PORT']) || 8080;

createServer(async (req, res) =>
{
  let path = normalize(decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)).replace(/^[\\/]+/, '');
  if (path.startsWith('..'))
  {
    return void res.writeHead(403).end();
  }
  if (!path)
  {
    return void res.writeHead(302, { location: '/demo/' }).end();
  }
  if (/[\\/]$/.test(path))
  {
    path += 'index.html';
  }
  try
  {
    const body = await readFile(join(root, path));
    res.writeHead(200, { 'content-type': types[extname(path)] || 'application/octet-stream' }).end(body);
  }
  catch
  {
    res.writeHead(404).end('not found');
  }
}).listen(port, () => console.log(`demo: http://localhost:${port}/demo/`));
