// Ponte para servidores de linguagem (LSP) via stdio: clangd, pyright, pylsp...
// O processo principal só enquadra as mensagens (Content-Length); o protocolo fica no renderer (src/lsp-client.js)
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const servers = new Map(); // id -> { proc, buffer }
let loginPath = null;
const IS_WIN = process.platform === 'win32';
// no Windows, npm/pyright etc. são scripts .cmd: precisam de shell para executar
const needsShell = bin => IS_WIN && /\.(cmd|bat)$/i.test(bin);

// Apps abertos pelo Finder não herdam o PATH do terminal (/opt/homebrew/bin etc.)
function resolveLoginPath() {
  if (loginPath) return Promise.resolve(loginPath);
  if (IS_WIN) { loginPath = process.env.PATH || process.env.Path || ''; return Promise.resolve(loginPath); }
  return new Promise(resolve => {
    const shell = process.env.SHELL || '/bin/zsh';
    execFile(shell, ['-lc', 'printf "%s" "$PATH"'], { timeout: 4000 }, (err, out) => {
      loginPath = !err && out ? out.trim() : process.env.PATH;
      const merged = [...new Set([...loginPath.split(':'), ...(process.env.PATH || '').split(':')])].filter(Boolean);
      loginPath = merged.join(':');
      process.env.PATH = loginPath;
      resolve(loginPath);
    });
  });
}

async function which(cmd) {
  const exts = IS_WIN ? ['', ...(process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').map(e => e.toLowerCase())] : [''];
  if (path.isAbsolute(cmd)) {
    for (const e of exts) if (fs.existsSync(cmd + e) && (!IS_WIN || e || path.extname(cmd))) return cmd + e;
    return null;
  }
  const p = await resolveLoginPath();
  for (const dir of p.split(path.delimiter)) {
    if (!dir) continue;
    for (const e of exts) {
      const full = path.join(dir, cmd + e);
      // no Windows ignora o arquivo sem extensão (script sh do npm que o Windows não executa)
      if (IS_WIN && !path.extname(full)) continue;
      try { fs.accessSync(full, IS_WIN ? fs.constants.F_OK : fs.constants.X_OK); return full; } catch {}
    }
  }
  return null;
}

async function start(id, config, root, send) {
  stop(id);
  const bin = await which(config.command);
  if (!bin) return { ok: false, error: `"${config.command}" não encontrado no PATH` };
  const proc = spawn(bin, config.args || [], { cwd: root || require('os').homedir(), env: { ...process.env, PATH: loginPath }, stdio: ['pipe', 'pipe', 'pipe'], shell: needsShell(bin), windowsHide: true });
  const state = { proc, buffer: Buffer.alloc(0) };
  servers.set(id, state);

  proc.stdout.on('data', chunk => {
    state.buffer = Buffer.concat([state.buffer, chunk]);
    for (;;) {
      const headerEnd = state.buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) break;
      const header = state.buffer.toString('ascii', 0, headerEnd);
      const m = header.match(/Content-Length:\s*(\d+)/i);
      if (!m) { state.buffer = state.buffer.subarray(headerEnd + 4); continue; }
      const len = Number(m[1]);
      const start = headerEnd + 4;
      if (state.buffer.length < start + len) break;
      const body = state.buffer.toString('utf8', start, start + len);
      state.buffer = state.buffer.subarray(start + len);
      try { send('lsp:message', id, JSON.parse(body)); } catch {}
    }
  });
  proc.stderr.on('data', () => {}); // clangd é verboso no stderr
  proc.on('exit', code => {
    if (servers.get(id)?.proc === proc) servers.delete(id);
    send('lsp:exit', id, code);
  });
  proc.on('error', e => send('lsp:exit', id, String(e)));
  return { ok: true, command: bin };
}

function write(id, msg) {
  const s = servers.get(id);
  if (!s || !s.proc.stdin.writable) return;
  const body = Buffer.from(JSON.stringify(msg), 'utf8');
  s.proc.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
  s.proc.stdin.write(body);
}

function stop(id) {
  const s = servers.get(id);
  if (!s) return;
  servers.delete(id);
  try { s.proc.kill(); } catch {}
}

function stopAll() { for (const id of [...servers.keys()]) stop(id); }

// ---------- verificação de sintaxe sem servidor (Python) ----------
const PY_CHECK = `
import sys, json, warnings
src = sys.stdin.read()
warnings.simplefilter('ignore')
try:
    compile(src, sys.argv[1], 'exec')
    print('[]')
except SyntaxError as e:
    print(json.dumps([{"line": e.lineno or 1, "col": e.offset or 1, "endLine": getattr(e, 'end_lineno', None) or e.lineno or 1,
                       "endCol": getattr(e, 'end_offset', None) or (e.offset or 1) + 1, "message": e.msg}]))
`;

async function lintPython(file, text) {
  // no Windows, "python3" costuma ser o atalho da Microsoft Store: tenta "python" e o launcher "py"
  const py = IS_WIN ? ((await which('python')) || (await which('py')) || (await which('python3'))) : ((await which('python3')) || '/usr/bin/python3');
  if (!py) return [];
  return new Promise(resolve => {
    const p = execFile(py, ['-I', '-c', PY_CHECK, file || '<editor>'], { timeout: 5000, maxBuffer: 1 << 20, windowsHide: true }, (err, out) => {
      try { resolve(JSON.parse(out)); } catch { resolve([]); }
    });
    p.stdin.end(text);
  });
}

module.exports = { start, write, stop, stopAll, which, lintPython, resolveLoginPath, needsShell };
