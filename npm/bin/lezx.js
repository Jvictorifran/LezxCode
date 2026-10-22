#!/usr/bin/env node
// lezx — instala (na primeira vez) e abre o Lezx Code. Uso: lezx [pasta|arquivo...] | --install | --update | --where | --version
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { spawn, spawnSync } = require('child_process');

const VERSION = require('../package.json').version;
const REPO = 'Jvictorifran/LezxCode';
const BASE = `https://github.com/${REPO}/releases/download/v${VERSION}`;
const IS_MAC = process.platform === 'darwin';
const IS_WIN = process.platform === 'win32';

if (!IS_MAC && !IS_WIN) die('O Lezx Code está disponível para macOS e Windows.');

function die(msg) { console.error(`lezx: ${msg}`); process.exit(1); }

function appCandidates() {
  if (IS_MAC) return ['/Applications/Lezx Code.app', path.join(os.homedir(), 'Applications', 'Lezx Code.app')];
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return [path.join(local, 'Programs', 'Lezx Code', 'Lezx Code.exe'), path.join(local, 'Programs', 'lezx-code', 'Lezx Code.exe'),path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Lezx Code', 'Lezx Code.exe')];
}
const findApp = () => appCandidates().find(p => fs.existsSync(p));

function installedVersion(app) {
  try {
    if (IS_MAC) return spawnSync('defaults', ['read', path.join(app, 'Contents', 'Info.plist'), 'CFBundleShortVersionString'], { encoding: 'utf8' }).stdout.trim();
  } catch {}
  return null;
}

function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'lezx-cli' } }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects < 10) {
        res.resume();
        return resolve(download(new URL(res.headers.location, url).toString(), dest, redirects + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`download falhou (${res.statusCode}): ${url}`)); }
      const total = Number(res.headers['content-length']) || 0;
      let got = 0, last = -1;
      const out = fs.createWriteStream(dest);
      res.on('data', chunk => {
        got += chunk.length;
        const pct = total ? Math.floor((got / total) * 100) : 0;
        if (process.stderr.isTTY && pct !== last) { last = pct; process.stderr.write(`\rBaixando Lezx Code ${VERSION}… ${pct}% (${(got / 1048576).toFixed(0)} MB)`); }
      });
      res.pipe(out);
      out.on('finish', () => { if (process.stderr.isTTY) process.stderr.write('\n'); out.close(resolve); });
      out.on('error', reject);
    }).on('error', reject);
  });
}

async function install() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lezx-'));
  try {
    if (IS_MAC) {
      const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
      const zip = path.join(tmp, 'lezx.zip');
      await download(`${BASE}/Lezx-Code-${VERSION}-${arch}-mac.zip`, zip);
      // /Applications quando dá para escrever; senão ~/Applications
      const target = (() => { try { fs.accessSync('/Applications', fs.constants.W_OK); return '/Applications'; } catch { return path.join(os.homedir(), 'Applications'); } })();
      fs.mkdirSync(target, { recursive: true });
      const dest = path.join(target, 'Lezx Code.app');
      if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
      console.error(`Instalando em ${target}…`);
      const r = spawnSync('ditto', ['-x', '-k', zip, target], { stdio: 'inherit' });
      if (r.status !== 0) die('não foi possível extrair o app');
      // o app tem assinatura ad-hoc: remove a quarentena para o macOS não bloquear a abertura
      spawnSync('xattr', ['-dr', 'com.apple.quarantine', dest]);
      return dest;
    }
    const setup = path.join(tmp, 'lezx-setup.exe');
    await download(`${BASE}/Lezx-Code-${VERSION}-x64-setup.exe`, setup);
    console.error('Instalando…');
    const r = spawnSync(setup, ['/S'], { stdio: 'inherit' });
    if (r.status !== 0) die(`o instalador terminou com erro (${r.status})`);
    const app = findApp();
    if (!app) die('instalação concluída, mas o Lezx Code não foi encontrado');
    return app;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function launch(app, args) {
  const paths = args.map(a => path.resolve(a));
  if (IS_MAC) spawn('open', ['-a', app, ...paths], { stdio: 'ignore', detached: true }).unref();
  else spawn(app, paths, { stdio: 'ignore', detached: true, windowsHide: false }).unref();
}

(async () => {
  const args = process.argv.slice(2);
  if (args.includes('--version') || args.includes('-v')) { console.log(VERSION); return; }
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`Lezx Code ${VERSION}

Uso:
  lezx                 abre o Lezx Code
  lezx .               abre a pasta atual
  lezx arquivo.html    abre um arquivo
  lezx --install       só instala (ou reinstala) o app
  lezx --update        reinstala a versão ${VERSION} do app
  lezx --where         mostra onde o app está instalado`);
    return;
  }
  let app = findApp();
  if (args.includes('--where')) { console.log(app || 'não instalado'); return; }
  const force = args.includes('--install') || args.includes('--update');
  if (app && IS_MAC && !force) {
    const v = installedVersion(app);
    if (v && v !== VERSION) console.error(`lezx: app instalado é a versão ${v}; rode "lezx --update" para instalar a ${VERSION}.`);
  }
  if (!app || force) {
    try { app = await install(); } catch (e) { die(e.message); }
    console.error('Lezx Code instalado.');
    if (force) return;
  }
  launch(app, args.filter(a => !a.startsWith('--')));
})();
