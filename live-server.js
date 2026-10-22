// Live Server embutido: servidor estático + recarregamento automático (SSE, sem dependências)
const http = require('http');
const fs = require('fs');
const path = require('path');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.map': 'application/json', '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.avif': 'image/avif', '.ico': 'image/x-icon', '.bmp': 'image/bmp',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
  '.pdf': 'application/pdf', '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json'
};

const CLIENT = `<script>(function(){
  if (window.__lezxLive) return; window.__lezxLive = true;
  function connect(){
    var es = new EventSource('/__lezx_live');
    es.onmessage = function(e){
      if (e.data === 'css') {
        document.querySelectorAll('link[rel="stylesheet"]').forEach(function(l){
          var u = new URL(l.href); u.searchParams.set('_lezx', Date.now()); l.href = u.toString();
        });
      } else if (e.data === 'reload') location.reload();
    };
    es.onerror = function(){ es.close(); setTimeout(connect, 1000); };
  }
  connect();
  console.log('%c Lezx Live Server conectado ', 'background:#7c5cff;color:#fff;border-radius:3px');
})();</script>`;

let server = null;
let root = null;
let port = null;
const clients = new Set();
let timer = null, cssOnly = true;

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function inject(html) {
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>(?![\s\S]*<\/body>)/i, CLIENT + '</body>');
  return html + CLIENT;
}

function listing(dir, urlPath) {
  const items = fs.readdirSync(dir, { withFileTypes: true })
    .filter(e => !e.name.startsWith('.'))
    .sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1))
    .map(e => {
      const href = path.posix.join(urlPath, encodeURIComponent(e.name)) + (e.isDirectory() ? '/' : '');
      return `<li><a href="${href}">${e.isDirectory() ? '📁' : '📄'} ${escapeHtml(e.name)}</a></li>`;
    }).join('');
  return `<!doctype html><meta charset="utf-8"><title>${escapeHtml(urlPath)}</title>
<style>body{font:15px -apple-system,system-ui,sans-serif;background:#16171d;color:#ddd;padding:32px}a{color:#a99bff;text-decoration:none}li{list-style:none;padding:4px 0}h1{font-weight:600;font-size:18px}</style>
<h1>Índice de ${escapeHtml(urlPath)}</h1><ul>${urlPath !== '/' ? '<li><a href="../">⬆️ ..</a></li>' : ''}${items}</ul>`;
}

function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/__lezx_live') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write('retry: 1000\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch { rel = url.pathname; }
  let file = path.normalize(path.join(root, rel));
  if (!file.startsWith(root)) { res.writeHead(403); return res.end('Proibido'); }

  fs.stat(file, (err, st) => {
    if (!err && st.isDirectory()) {
      if (!url.pathname.endsWith('/')) { res.writeHead(301, { Location: url.pathname + '/' + url.search }); return res.end(); }
      const index = ['index.html', 'index.htm'].map(n => path.join(file, n)).find(f => fs.existsSync(f));
      if (!index) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(inject(listing(file, url.pathname)));
      }
      file = index;
    } else if (err) {
      // tenta "pagina" -> "pagina.html"
      if (fs.existsSync(file + '.html')) file = file + '.html';
      else {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(inject(`<!doctype html><meta charset="utf-8"><body style="font:15px system-ui;background:#16171d;color:#ddd;padding:32px"><h2>404</h2><p>${escapeHtml(rel)} não encontrado</p></body>`));
      }
    }
    const ext = path.extname(file).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    const headers = { 'Content-Type': type, 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' };
    if (ext === '.html' || ext === '.htm') {
      fs.readFile(file, 'utf8', (e, html) => {
        if (e) { res.writeHead(500); return res.end(String(e)); }
        res.writeHead(200, headers);
        res.end(inject(html));
      });
    } else {
      fs.stat(file, (e2, st2) => {
        if (e2) { res.writeHead(500); return res.end(String(e2)); }
        const range = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
        if (range) {
          const start = range[1] ? +range[1] : 0;
          const end = range[2] ? +range[2] : st2.size - 1;
          res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${st2.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 });
          fs.createReadStream(file, { start, end }).pipe(res);
        } else {
          res.writeHead(200, { ...headers, 'Content-Length': st2.size, 'Accept-Ranges': 'bytes' });
          fs.createReadStream(file).pipe(res);
        }
      });
    }
  });
}

function listen(p) {
  return new Promise((resolve, reject) => {
    const s = http.createServer(handler);
    s.once('error', reject);
    s.listen(p, '127.0.0.1', () => resolve(s));
  });
}

async function start(dir, preferredPort = 5500) {
  if (server && root === dir) return { port };
  await stop();
  root = path.resolve(dir);
  for (let p = preferredPort; p < preferredPort + 50; p++) {
    try { server = await listen(p); port = p; return { port }; }
    catch (e) { if (e.code !== 'EADDRINUSE') throw e; }
  }
  throw new Error('Nenhuma porta livre encontrada');
}

function stop() {
  return new Promise(resolve => {
    for (const c of clients) { try { c.end(); } catch {} }
    clients.clear();
    if (!server) return resolve();
    server.close(() => resolve());
    server.closeAllConnections?.();
    server = null; port = null; root = null;
  });
}

function notifyChange(file) {
  if (!server || !file.startsWith(root)) return;
  if (/(^|[\/\\])(\.git|node_modules)([\/\\]|$)/.test(file)) return;
  if (path.extname(file).toLowerCase() !== '.css') cssOnly = false;
  clearTimeout(timer);
  timer = setTimeout(() => {
    const msg = cssOnly ? 'css' : 'reload';
    for (const c of clients) c.write(`data: ${msg}\n\n`);
    cssOnly = true;
  }, 100);
}

function status() { return server ? { running: true, port, root } : { running: false }; }

module.exports = { start, stop, notifyChange, status, MIME };
