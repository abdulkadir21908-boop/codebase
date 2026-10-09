/**
 * Zero-dependency static file server for Apex Velocity.
 * Usage:  node serve.mjs [port]
 */
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync, writeFile, mkdir } from 'node:fs';
import { promisify } from 'node:util';

const writeFileAsync = promisify(writeFile);
const mkdirAsync = promisify(mkdir);
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)));
const PORT = Number(process.argv[2] || process.env.PORT || 5173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

const server = createServer((req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    /* dev-only: receive a canvas capture from the page (?shot=1 mode) */
    if (req.method === 'POST' && url.pathname === '/__shot') {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', async () => {
        const body = Buffer.concat(chunks).toString('utf8');
        const name = (url.searchParams.get('name') || 'shot').replace(/[^\w.-]/g, '');
        const m = /^data:image\/(png|jpeg);base64,(.+)$/s.exec(body);
        if (!m) { res.writeHead(400).end('bad payload'); return; }
        const dir = join(ROOT, 'shots');
        if (!existsSync(dir)) await mkdirAsync(dir);
        await writeFileAsync(join(dir, `${name}.${m[1] === 'png' ? 'png' : 'jpg'}`), Buffer.from(m[2], 'base64'));
        res.writeHead(200, { 'content-type': 'text/plain' }).end('saved ' + name);
      });
      return;
    }
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';

    const filePath = join(ROOT, normalize(pathname).replace(/^(\.\.[/\\])+/, ''));
    if (!filePath.startsWith(ROOT + sep) && filePath !== join(ROOT, 'index.html')) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('404 Not Found: ' + pathname);
      return;
    }

    res.writeHead(200, {
      'content-type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-store, no-cache, must-revalidate',
    });
    createReadStream(filePath).pipe(res);
  } catch (err) {
    res.writeHead(500, { 'content-type': 'text/plain' }).end('500 ' + err.message);
  }
});

server.listen(PORT, () => {
  console.log(`\n  Apex Velocity running ->  http://localhost:${PORT}\n`);
});
