import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

// Serve only built public assets. No workspace API, credentials or runtime files.
const types = new Map([
  ['index.html', 'text/html; charset=utf-8'],
  ['demo-zh.html', 'text/html; charset=utf-8'],
  ['demo-zh.mjs', 'text/javascript; charset=utf-8'],
  ['demo-profit.mjs', 'text/javascript; charset=utf-8'],
  ['demo-zh.css', 'text/css; charset=utf-8'],
  ['mark.svg', 'image/svg+xml'],
  ['aigc-before.png', 'image/png'],
  ['aigc-after.png', 'image/png'],
  ['xds-brief.zh.txt', 'text/plain; charset=utf-8'],
]);
const port = Number(process.env.OPS_DEMO_PORT || 4174);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('Invalid OPS_DEMO_PORT');
const root = new URL('../public-demo/', import.meta.url);
await readFile(new URL('index.html', root)).catch(() => {
  throw Error('Build the public demo first: npm run demo:build');
});
const server = createServer(async (req, res) => {
  if (!['GET', 'HEAD'].includes(req.method)) {
    res.writeHead(405, {Allow: 'GET, HEAD'}); res.end(); return;
  }
  const name = req.url === '/' ? 'index.html' : req.url?.split('?')[0]?.slice(1);
  if (!types.has(name)) { res.writeHead(404); res.end('Not found'); return; }
  try {
    const body = await readFile(new URL(name, root));
    res.writeHead(200, {'Content-Type': types.get(name), 'Content-Length': body.length,
      'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store'});
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch { res.writeHead(404); res.end('Build the public demo first'); }
});
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => console.log(`Public synthetic demo: http://127.0.0.1:${port}/ (${fileURLToPath(root)})`));
