// Extensões de linguagem: catálogo (JSON), instalação e servidores de linguagem baixados via npm
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { spawn } = require('child_process');
const lsp = require('./lsp');

function createExtensionManager({ appDir, userDir, readJSON, send }) {
  const builtinDir = path.join(appDir, 'extensions');
  const userExtDir = path.join(userDir, 'extensions');
  const serversDir = path.join(userDir, 'servers');
  const stateFile = path.join(userDir, 'extensions-state.json');
  fs.mkdirSync(userExtDir, { recursive: true });
  const installing = new Map(); // id -> Promise

  const loadState = () => readJSON(stateFile, { installed: [] });
  const saveState = s => fs.writeFileSync(stateFile, JSON.stringify(s, null, 2));

  function catalog() {
    const out = new Map();
    for (const [dir, source] of [[builtinDir, 'builtin'], [userExtDir, 'user']]) {
      let files = [];
      try { files = fs.readdirSync(dir).filter(f => f.endsWith('.json')); } catch {}
      for (const f of files) {
        const ext = readJSON(path.join(dir, f), null);
        if (!ext || !Array.isArray(ext.languages)) continue;
        ext.id ||= f.replace(/\.json$/, '');
        out.set(ext.id, { ...ext, source, file: path.join(dir, f) });
      }
    }
    return out;
  }

  // procura o executável do servidor: primeiro nos servidores baixados pelo Lezx, depois no PATH
  async function findServer(server) {
    if (!server?.command) return null;
    const local = path.join(serversDir, 'node_modules', '.bin', server.command + (process.platform === 'win32' ? '.cmd' : ''));
    if (fs.existsSync(local)) return local;
    return lsp.which(server.command);
  }

  async function list() {
    const state = loadState();
    const out = [];
    for (const ext of catalog().values()) {
      const installed = state.installed.includes(ext.id) || (ext.source === 'user' && !state.disabled?.includes(ext.id));
      let serverState = 'none';
      if (ext.server) serverState = (await findServer(ext.server)) ? 'ready' : ext.server.npm ? 'npm' : 'missing';
      out.push({ ...ext, installed, serverState, installing: installing.has(ext.id) });
    }
    return out.sort((a, b) => (b.installed - a.installed) || a.name.localeCompare(b.name));
  }

  function npmInstall(id, pkg) {
    return new Promise(async (resolve, reject) => {
      const npm = await lsp.which('npm');
      if (!npm) return reject(new Error('npm não encontrado. Instale o Node.js (nodejs.org) para baixar este servidor de linguagem.'));
      await fsp.mkdir(serversDir, { recursive: true });
      if (!fs.existsSync(path.join(serversDir, 'package.json'))) {
        await fsp.writeFile(path.join(serversDir, 'package.json'), JSON.stringify({ name: 'lezx-servers', private: true }, null, 2));
      }
      const pkgs = Array.isArray(pkg) ? pkg : [pkg];
      const p = spawn(npm, ['install', '--no-audit', '--no-fund', '--loglevel=error', ...pkgs], { cwd: serversDir, env: process.env, shell: lsp.needsShell(npm), windowsHide: true });
      let err = '';
      p.stdout.on('data', d => send('ext:progress', id, String(d).trim().split('\n').pop()));
      p.stderr.on('data', d => { err += d; });
      p.on('error', reject);
      p.on('exit', code => code === 0 ? resolve() : reject(new Error(`npm install falhou (${code}): ${err.trim().split('\n').slice(-3).join(' ')}`)));
    });
  }

  async function install(id) {
    const ext = catalog().get(id);
    if (!ext) throw new Error('Extensão não encontrada');
    if (installing.has(id)) return installing.get(id);
    const job = (async () => {
      send('ext:progress', id, 'Instalando…');
      if (ext.server?.npm && !(await findServer(ext.server))) {
        send('ext:progress', id, `Baixando ${[].concat(ext.server.npm).join(', ')} (npm)…`);
        await npmInstall(id, ext.server.npm);
      }
      const state = loadState();
      if (!state.installed.includes(id)) state.installed.push(id);
      state.disabled = (state.disabled || []).filter(x => x !== id);
      saveState(state);
    })();
    installing.set(id, job);
    try { await job; } finally { installing.delete(id); send('ext:changed'); }
  }

  async function uninstall(id) {
    const state = loadState();
    state.installed = state.installed.filter(x => x !== id);
    const ext = catalog().get(id);
    if (ext?.source === 'user') state.disabled = [...new Set([...(state.disabled || []), id])];
    saveState(state);
    lsp.stop(id);
    // remove o servidor baixado pelo Lezx (não mexe em servidores do sistema)
    if (ext?.server?.npm) {
      const npm = await lsp.which('npm');
      if (npm && fs.existsSync(path.join(serversDir, 'node_modules'))) {
        await new Promise(r => spawn(npm, ['uninstall', '--no-audit', '--no-fund', ...[].concat(ext.server.npm)], { cwd: serversDir, shell: lsp.needsShell(npm), windowsHide: true }).on('exit', r).on('error', r));
      }
    }
    send('ext:changed');
  }

  async function startServer(id, root) {
    const ext = catalog().get(id);
    if (!ext?.server) return { ok: false, error: 'Extensão sem servidor' };
    const bin = await findServer(ext.server);
    if (!bin) return { ok: false, error: `${ext.server.command} não encontrado` };
    return lsp.start(id, { command: bin, args: ext.server.args }, root, send);
  }

  return { list, install, uninstall, startServer, userExtDir, catalog };
}

module.exports = { createExtensionManager };
