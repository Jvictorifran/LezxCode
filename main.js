// Lezx Code — processo principal (Electron)
const { app, BrowserWindow, ipcMain, dialog, Menu, shell, protocol, net, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { pathToFileURL } = require('url');
const liveServer = require('./live-server');

const IS_MAC = process.platform === 'darwin';
const IS_WIN = process.platform === 'win32';
// no Windows a interface trabalha com "C:/pasta/arquivo" (barras normais): o Node aceita e o renderer usa "/" em tudo
const WIN_PATH = /^(?:[A-Za-z]:\\|\\\\)/;
function uiPaths(v, key) {
  if (!IS_WIN || key === 'content') return v;
  if (typeof v === 'string') return WIN_PATH.test(v) ? v.replace(/\\/g, '/') : v;
  if (Array.isArray(v)) return v.map(x => uiPaths(x));
  if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = uiPaths(x, k); return o; }
  return v;
}
// canais cujo conteúdo não pode ser convertido (saída do terminal, mensagens LSP, conteúdo de arquivos)
const RAW_CHANNELS = new Set(['pty:data', 'lsp:message', 'fs:readFile', 'fs:readDataUrl', 'lint:python', 'ext:progress']);
const { createFontStore, systemFonts } = require('./fonts');
const lsp = require('./lsp');
const { createExtensionManager } = require('./extensions');

let pty = null;
try { pty = require('node-pty'); } catch (e) { console.error('node-pty indisponível:', e.message); }

// testes: LEZX_USER_DATA usa um perfil separado, sem tocar nas configurações reais
if (!app.isPackaged && process.env.LEZX_USER_DATA) app.setPath('userData', process.env.LEZX_USER_DATA);
const APP_DIR = __dirname;
const USER_DIR = app.getPath('userData');
const USER_THEMES = path.join(USER_DIR, 'themes');
const USER_ICON_THEMES = path.join(USER_DIR, 'icon-themes');
const SETTINGS_FILE = path.join(USER_DIR, 'settings.json');
const STATE_FILE = path.join(USER_DIR, 'state.json'); // janela, pastas recentes (separado das configurações)
const FONTS_DIR = path.join(USER_DIR, 'fonts');
const USER_TRANSLATIONS = path.join(USER_DIR, 'translations');

const DEFAULT_SETTINGS = {
  'workbench.colorTheme': 'Lezx Dark',
  'workbench.iconTheme': 'Lezx Icons',
  'workbench.sideBar.location': 'left',
  'workbench.fontFamily': "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif",
  'workbench.fontSize': 13,
  'editor.fontSize': 14,
  'editor.lineHeight': 0,
  'editor.cursorStyle': 'line',
  'editor.fontFamily': "'JetBrains Mono', 'Fira Code', 'SF Mono', Menlo, 'Cascadia Code', Consolas, monospace",
  'editor.fontLigatures': false,
  'editor.tabSize': 2,
  'editor.insertSpaces': true,
  'editor.wordWrap': 'off',
  'editor.minimap': true,
  'editor.lineNumbers': 'on',
  'editor.cursorBlinking': 'smooth',
  'editor.renderWhitespace': 'selection',
  'editor.bracketPairColorization': true,
  'editor.formatOnSave': false,
  'editor.errorLens': 'all',
  'editor.translateErrors': true,
  'editor.stickyScroll': false,
  'files.autoSave': 'off',
  'files.autoSaveDelay': 1000,
  'files.exclude': ['.git', '.DS_Store'],
  'search.exclude': ['node_modules', '.git', 'dist', 'build', '.next', 'vendor'],
  'terminal.fontSize': 13,
  'terminal.fontFamily': "'FiraCode Nerd Font Mono', 'MesloLGS NF', 'JetBrainsMono Nerd Font Mono', 'Hack Nerd Font Mono', 'SF Mono', Menlo, 'Cascadia Mono', Consolas, monospace",
  'terminal.lineHeight': 1.1,
  'terminal.cursorStyle': 'block',
  'terminal.shell': '',
  'liveServer.port': 5500,
  'liveServer.openBrowser': true
};

protocol.registerSchemesAsPrivileged([
  { scheme: 'lezx', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }
]);

let win = null;
let fontStore = null;
let extensions = null;
let currentRoot = null;
let rootWatcher = null;
let dirtyCount = 0;
const terminals = new Map();

// ---------- utilidades ----------
function send(channel, ...args) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...(RAW_CHANNELS.has(channel) ? args : args.map(a => uiPaths(a))));
}

function readJSON(file, fallback) {
  try { return JSON.parse(stripJsonComments(fs.readFileSync(file, 'utf8'))); } catch { return fallback; }
}

// Permite comentários // e /* */ e vírgulas finais nos JSON do usuário
function stripJsonComments(text) {
  let out = '', inStr = false, i = 0;
  while (i < text.length) {
    const c = text[i], n = text[i + 1];
    if (inStr) {
      out += c;
      if (c === '\\') { out += n; i += 2; continue; }
      if (c === '"') inStr = false;
      i++;
    } else if (c === '"') { inStr = true; out += c; i++; }
    else if (c === '/' && n === '/') { while (i < text.length && text[i] !== '\n') i++; }
    else if (c === '/' && n === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++; i += 2; }
    else { out += c; i++; }
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}

function ensureUserDirs() {
  for (const d of [USER_DIR, USER_THEMES, USER_ICON_THEMES, USER_TRANSLATIONS]) fs.mkdirSync(d, { recursive: true });
  const exampleTr = path.join(USER_TRANSLATIONS, 'minhas-traducoes.json');
  if (!fs.existsSync(exampleTr)) fs.copyFileSync(path.join(APP_DIR, 'examples', 'exemplo-minhas-traducoes.json'), exampleTr);
  if (!fs.existsSync(SETTINGS_FILE)) {
    // só as opções mais comuns; o resto usa os padrões (lista completa: Cmd+Shift+P > Configurações)
    const starter = {};
    for (const k of ['workbench.colorTheme', 'workbench.iconTheme', 'editor.fontSize', 'editor.fontFamily', 'editor.tabSize', 'editor.wordWrap', 'editor.minimap', 'editor.formatOnSave', 'files.autoSave', 'terminal.fontSize', 'terminal.fontFamily', 'liveServer.port']) starter[k] = DEFAULT_SETTINGS[k];
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(starter, null, 2));
  }
  const exampleTheme = path.join(USER_THEMES, 'exemplo-meu-tema.json');
  if (!fs.existsSync(exampleTheme)) {
    fs.copyFileSync(path.join(APP_DIR, 'examples', 'exemplo-meu-tema.json'), exampleTheme);
  }
  // extensão de exemplo: copiada desativada, para o usuário ativar quando quiser
  const exampleExt = path.join(USER_DIR, 'extensions', 'exemplo-minha-extensao.json');
  if (!fs.existsSync(exampleExt)) {
    fs.mkdirSync(path.dirname(exampleExt), { recursive: true });
    fs.copyFileSync(path.join(APP_DIR, 'examples', 'exemplo-minha-extensao.json'), exampleExt);
    const stFile = path.join(USER_DIR, 'extensions-state.json');
    const st = readJSON(stFile, { installed: [] });
    st.disabled = [...new Set([...(st.disabled || []), 'exemplo-minha-extensao'])];
    fs.writeFileSync(stFile, JSON.stringify(st, null, 2));
  }
  const exampleIcons = path.join(USER_ICON_THEMES, 'exemplo-meus-icones.json');
  if (!fs.existsSync(exampleIcons)) {
    fs.copyFileSync(path.join(APP_DIR, 'examples', 'exemplo-meus-icones.json'), exampleIcons);
  }
}

function loadSettings() {
  const user = readJSON(SETTINGS_FILE, {});
  return { ...DEFAULT_SETTINGS, ...user };
}

function saveSettings(patch, removeKeys = []) {
  const user = readJSON(SETTINGS_FILE, {});
  Object.assign(user, patch);
  for (const k of removeKeys) delete user[k];
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(user, null, 2));
  send('settings:changed', loadSettings());
}

const loadState = () => readJSON(STATE_FILE, {});
function saveState(patch) {
  fs.writeFileSync(STATE_FILE, JSON.stringify({ ...loadState(), ...patch }, null, 2));
}

// versões antigas guardavam o estado da janela no settings.json
function migrateState() {
  const user = readJSON(SETTINGS_FILE, null);
  if (!user) return;
  const keys = Object.keys(user).filter(k => k.startsWith('window.'));
  if (!keys.length) return;
  if (user['window.bounds']) saveState({ bounds: user['window.bounds'] });
  for (const k of keys) delete user[k];
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(user, null, 2));
}

function recentFolders() {
  return (loadState().recentFolders || []).filter(p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } });
}

// ---------- temas ----------
function listThemeFiles(builtinDir, userDir) {
  const out = [];
  for (const [dir, source] of [[builtinDir, 'builtin'], [userDir, 'user']]) {
    let files = [];
    try { files = fs.readdirSync(dir).filter(f => f.endsWith('.json')); } catch {}
    for (const f of files) {
      const file = path.join(dir, f);
      const data = readJSON(file, null);
      if (!data) continue;
      out.push({ id: data.name || f.replace(/\.json$/, ''), name: data.name || f, type: data.type || 'dark', source, file });
    }
  }
  return out;
}

const listColorThemes = () => listThemeFiles(path.join(APP_DIR, 'themes'), USER_THEMES);
const listIconThemes = () => listThemeFiles(path.join(APP_DIR, 'icon-themes'), USER_ICON_THEMES);

function readColorTheme(id) {
  const t = listColorThemes().find(t => t.id === id) || listColorThemes()[0];
  return { ...readJSON(t.file, {}), id: t.id };
}

// Resolve "iconPath" relativo (svg/png) para data URI, para que o renderer não precise de acesso ao disco
function readIconTheme(id) {
  const t = listIconThemes().find(t => t.id === id) || listIconThemes()[0];
  const data = readJSON(t.file, {});
  const base = path.dirname(t.file);
  for (const def of Object.values(data.iconDefinitions || {})) {
    if (def.iconPath) {
      try {
        const p = path.resolve(base, def.iconPath);
        const ext = path.extname(p).slice(1).toLowerCase();
        const mime = ext === 'svg' ? 'image/svg+xml' : `image/${ext}`;
        def.src = `data:${mime};base64,${fs.readFileSync(p).toString('base64')}`;
      } catch {}
    }
  }
  return { ...data, id: t.id };
}

function watchUserDirs() {
  let timer = null;
  const notify = () => { clearTimeout(timer); timer = setTimeout(() => send('themes:changed'), 150); };
  for (const d of [USER_THEMES, USER_ICON_THEMES]) {
    try { fs.watch(d, { recursive: true }, notify); } catch {}
  }
  let tt = null;
  try { fs.watch(USER_TRANSLATIONS, () => { clearTimeout(tt); tt = setTimeout(() => send('translations:changed'), 150); }); } catch {}
  let st = null;
  try {
    fs.watch(SETTINGS_FILE, () => { clearTimeout(st); st = setTimeout(() => send('settings:changed', loadSettings()), 150); });
  } catch {}
}

// ---------- sistema de arquivos ----------
async function readDir(dir) {
  const settings = loadSettings();
  const exclude = new Set(settings['files.exclude'] || []);
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  return entries
    .filter(e => !exclude.has(e.name))
    .map(e => {
      let isDir = e.isDirectory();
      if (e.isSymbolicLink()) { try { isDir = fs.statSync(path.join(dir, e.name)).isDirectory(); } catch {} }
      return { name: e.name, path: path.join(dir, e.name), isDir };
    })
    .sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) : a.isDir ? -1 : 1));
}

async function walk(root, exclude, onFile, limit = 30000) {
  let count = 0;
  const stack = [root];
  while (stack.length && count < limit) {
    const dir = stack.pop();
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (exclude.has(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) { count++; if (await onFile(p) === false) return; }
    }
  }
}

function watchRoot(root) {
  if (rootWatcher) { rootWatcher.close(); rootWatcher = null; }
  if (!root) return;
  let pending = new Set(), timer = null;
  try {
    rootWatcher = fs.watch(root, { recursive: true }, (_evt, filename) => {
      if (!filename) return;
      const full = path.join(root, filename);
      liveServer.notifyChange(full);
      if (/(^|[\/\\])(\.git|node_modules)([\/\\]|$)/.test(filename)) return;
      pending.add(full);
      clearTimeout(timer);
      timer = setTimeout(() => { send('fs:changed', [...pending]); pending = new Set(); }, 120);
    });
  } catch (e) { console.error('watch falhou', e); }
}

function setRoot(root) {
  currentRoot = root;
  watchRoot(root);
  if (root) {
    app.addRecentDocument(root);
    saveState({ lastFolder: root, recentFolders: [root, ...recentFolders().filter(p => p !== root)].slice(0, 12) });
  } else saveState({ lastFolder: null });
  if (win) win.setTitle(root ? `${path.basename(root)} — Lezx Code` : 'Lezx Code');
  rebuildMenu();
}

// ---------- IPC ----------
function registerIpc() {
  const rawHandle = ipcMain.handle.bind(ipcMain);
  // respostas passam por uiPaths (só tem efeito no Windows)
  ipcMain.handle = (channel, fn) => rawHandle(channel, async (...a) => {
    const r = await fn(...a);
    return RAW_CHANNELS.has(channel) ? r : uiPaths(r);
  });
  ipcMain.handle('app:info', () => ({
    userDir: USER_DIR, themesDir: USER_THEMES, iconThemesDir: USER_ICON_THEMES,
    settingsFile: SETTINGS_FILE, home: app.getPath('home'), version: app.getVersion(),
    root: currentRoot, hasPty: !!pty
  }));
  ipcMain.handle('settings:get', () => loadSettings());
  ipcMain.handle('settings:set', (_e, patch) => saveSettings(patch));
  ipcMain.handle('settings:defaults', () => DEFAULT_SETTINGS);
  ipcMain.handle('settings:reset', (_e, keys) => saveSettings({}, keys));
  ipcMain.handle('state:recentFolders', () => recentFolders());
  ipcMain.handle('state:removeRecent', (_e, p) => { saveState({ recentFolders: recentFolders().filter(x => x !== p) }); rebuildMenu(); });

  ipcMain.handle('ext:list', () => extensions.list());
  ipcMain.handle('ext:install', (_e, id) => extensions.install(id));
  ipcMain.handle('ext:uninstall', (_e, id) => extensions.uninstall(id));
  ipcMain.handle('ext:openFolder', () => shell.openPath(extensions.userExtDir));
  ipcMain.handle('lsp:start', (_e, id, root) => extensions.startServer(id, root));
  ipcMain.on('lsp:send', (_e, id, msg) => lsp.write(id, msg));
  ipcMain.on('lsp:stop', (_e, id) => lsp.stop(id));
  ipcMain.handle('lint:python', (_e, file, text) => lsp.lintPython(file, text));

  ipcMain.handle('fonts:list', () => fontStore.list());
  ipcMain.handle('fonts:system', () => systemFonts());
  ipcMain.handle('fonts:remove', (_e, name) => fontStore.remove(name));
  ipcMain.handle('fonts:import', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Importar fontes', buttonLabel: 'Importar', properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Fontes', extensions: ['ttf', 'otf', 'ttc', 'woff', 'woff2'] }]
    });
    if (r.canceled) return [];
    return fontStore.import(r.filePaths);
  });
  ipcMain.handle('fonts:openFolder', () => shell.openPath(FONTS_DIR));

  // regras de tradução de erros: as do usuário primeiro (têm prioridade), depois as embutidas
  ipcMain.handle('translations:list', () => {
    const out = [];
    for (const [dir, source] of [[USER_TRANSLATIONS, 'user'], [path.join(APP_DIR, 'translations'), 'builtin']]) {
      let files = [];
      try { files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort(); } catch {}
      for (const f of files) {
        const data = readJSON(path.join(dir, f), null);
        if (!data) { if (source === 'user') send('translations:error', f); continue; }
        for (const rule of data.rules || []) if (rule?.match && rule.replace != null) out.push({ ...rule, source, file: f });
      }
    }
    return out;
  });
  ipcMain.handle('translations:dir', () => USER_TRANSLATIONS);
  ipcMain.handle('themes:list', () => listColorThemes());
  ipcMain.handle('themes:read', (_e, id) => readColorTheme(id));
  ipcMain.handle('iconThemes:list', () => listIconThemes());
  ipcMain.handle('iconThemes:read', (_e, id) => readIconTheme(id));

  ipcMain.handle('dialog:openFolder', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    setRoot(r.filePaths[0]);
    return r.filePaths[0];
  });
  // ⌘O: arquivo(s) ou pasta, como no VS Code para macOS
  ipcMain.handle('dialog:openAny', async () => {
    const r = await dialog.showOpenDialog(win, { buttonLabel: 'Abrir', properties: ['openFile', 'openDirectory', 'multiSelections', 'createDirectory'] });
    if (r.canceled) return { files: [], folder: null };
    const folder = r.filePaths.find(p => fs.statSync(p).isDirectory()) || null;
    if (folder) setRoot(folder);
    return { folder, files: r.filePaths.filter(p => !fs.statSync(p).isDirectory()) };
  });
  ipcMain.handle('dialog:openFile', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'] });
    return r.canceled ? [] : r.filePaths;
  });
  ipcMain.handle('dialog:saveAs', async (_e, defaultPath) => {
    const r = await dialog.showSaveDialog(win, { defaultPath: defaultPath || currentRoot || app.getPath('home') });
    return r.canceled ? null : r.filePath;
  });
  ipcMain.handle('dialog:confirm', async (_e, opts) => {
    const r = await dialog.showMessageBox(win, { type: 'question', buttons: opts.buttons, defaultId: 0, cancelId: opts.buttons.length - 1, message: opts.message, detail: opts.detail });
    return r.response;
  });

  ipcMain.handle('root:set', (_e, root) => { setRoot(root); return root; });
  ipcMain.handle('fs:readDir', (_e, dir) => readDir(dir));
  ipcMain.handle('fs:readFile', async (_e, file) => {
    const stat = await fsp.stat(file);
    if (stat.size > 20 * 1024 * 1024) throw new Error('Arquivo muito grande (>20MB)');
    const buf = await fsp.readFile(file);
    const binary = buf.subarray(0, 8000).includes(0);
    return { content: binary ? null : buf.toString('utf8'), binary, size: stat.size, mtime: stat.mtimeMs };
  });
  ipcMain.handle('fs:readDataUrl', async (_e, file) => {
    const ext = path.extname(file).slice(1).toLowerCase();
    const mime = liveServer.MIME['.' + ext] || 'application/octet-stream';
    return `data:${mime};base64,${(await fsp.readFile(file)).toString('base64')}`;
  });
  ipcMain.handle('fs:writeFile', async (_e, file, content) => {
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, content, 'utf8');
    return (await fsp.stat(file)).mtimeMs;
  });
  ipcMain.handle('fs:exists', (_e, p) => fs.existsSync(p));
  ipcMain.handle('fs:createFile', async (_e, file) => {
    if (fs.existsSync(file)) throw new Error('Já existe um arquivo com esse nome');
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, '');
  });
  ipcMain.handle('fs:createDir', (_e, dir) => fsp.mkdir(dir, { recursive: true }));
  ipcMain.handle('fs:rename', async (_e, from, to) => {
    if (fs.existsSync(to)) throw new Error('Já existe um item com esse nome');
    await fsp.rename(from, to);
  });
  ipcMain.handle('fs:trash', (_e, p) => shell.trashItem(p));
  ipcMain.handle('fs:copy', (_e, from, to) => fsp.cp(from, to, { recursive: true, errorOnExist: true, force: false }));

  ipcMain.handle('search:files', async (_e, root) => {
    const exclude = new Set([...(loadSettings()['search.exclude'] || []), ...(loadSettings()['files.exclude'] || [])]);
    const files = [];
    await walk(root, exclude, p => { files.push(p); });
    return files;
  });
  ipcMain.handle('search:text', async (_e, root, query, opts = {}) => {
    const settings = loadSettings();
    const exclude = new Set([...(settings['search.exclude'] || []), ...(settings['files.exclude'] || [])]);
    let re;
    try {
      const src = opts.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      re = new RegExp(opts.wholeWord ? `\\b${src}\\b` : src, opts.caseSensitive ? 'g' : 'gi');
    } catch (e) { throw new Error('Expressão regular inválida'); }
    const results = [];
    let total = 0;
    await walk(root, exclude, async p => {
      let st;
      try { st = await fsp.stat(p); } catch { return; }
      if (st.size > 2 * 1024 * 1024) return;
      let text;
      try { const buf = await fsp.readFile(p); if (buf.subarray(0, 4000).includes(0)) return; text = buf.toString('utf8'); } catch { return; }
      const matches = [];
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(lines[i])) !== null) {
          matches.push({ line: i + 1, col: m.index + 1, len: m[0].length || 1, text: lines[i].slice(0, 300) });
          total++;
          if (!m[0].length) re.lastIndex++;
          if (matches.length > 200) break;
        }
      }
      if (matches.length) results.push({ file: p, matches });
      if (total > 5000) return false;
    });
    return { results, total };
  });

  // terminal
  ipcMain.handle('pty:create', (_e, opts) => {
    if (!pty) throw new Error('Terminal indisponível');
    const settings = loadSettings();
    const shellPath = settings['terminal.shell'] || (IS_WIN ? 'powershell.exe' : process.env.SHELL || '/bin/zsh');
    const id = opts.id;
    const cwd = opts.cwd && fs.existsSync(opts.cwd) ? path.normalize(opts.cwd) : app.getPath('home');
    const p = pty.spawn(shellPath, IS_WIN ? [] : ['-l'], {
      name: 'xterm-256color',
      cols: opts.cols || 80,
      rows: opts.rows || 24,
      cwd,
      env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'LezxCode', ...(IS_WIN ? {} : { LANG: process.env.LANG || 'pt_BR.UTF-8' }) },
      useConpty: IS_WIN ? true : undefined
    });
    terminals.set(id, p);
    p.onData(d => send('pty:data', id, d));
    p.onExit(({ exitCode }) => { terminals.delete(id); send('pty:exit', id, exitCode); });
    return { pid: p.pid, shell: path.basename(shellPath).replace(/\.exe$/i, '') };
  });
  ipcMain.on('pty:write', (_e, id, data) => terminals.get(id)?.write(data));
  ipcMain.on('pty:resize', (_e, id, cols, rows) => { try { terminals.get(id)?.resize(Math.max(cols, 2), Math.max(rows, 1)); } catch {} });
  ipcMain.on('pty:kill', (_e, id) => { try { terminals.get(id)?.kill(); } catch {} terminals.delete(id); });

  // live server
  ipcMain.handle('live:start', async (_e, root, file) => {
    const settings = loadSettings();
    const info = await liveServer.start(root, settings['liveServer.port']);
    const rel = file && file.startsWith(root) ? path.relative(root, file).split(path.sep).join('/') : '';
    const url = `http://localhost:${info.port}/${rel}`;
    if (settings['liveServer.openBrowser']) shell.openExternal(url);
    send('live:status', { running: true, port: info.port });
    return { port: info.port, url };
  });
  ipcMain.handle('live:stop', async () => { await liveServer.stop(); send('live:status', { running: false }); });
  ipcMain.handle('live:status', () => liveServer.status());

  ipcMain.handle('shell:openExternal', (_e, url) => shell.openExternal(url));
  ipcMain.handle('shell:reveal', (_e, p) => shell.showItemInFolder(path.normalize(p)));
  ipcMain.handle('shell:openPath', (_e, p) => shell.openPath(path.normalize(p)));
  ipcMain.on('app:dirty', (_e, n) => { dirtyCount = n; if (win && IS_MAC) win.setDocumentEdited(n > 0); });
  // Windows: o menu fica num botão na barra de título; cores dos botões da janela seguem o tema
  ipcMain.on('menu:app', (_e, x, y) => Menu.getApplicationMenu()?.popup({ window: win, x, y }));
  ipcMain.on('app:titlebar', (_e, color, symbolColor) => { if (IS_WIN && win) try { win.setTitleBarOverlay({ color, symbolColor, height: 36 }); } catch {} });
  ipcMain.on('app:title', (_e, t) => { if (win) win.setTitle(t); });

  ipcMain.handle('menu:context', (e, items) => new Promise(resolve => {
    let chosen = null;
    const build = list => list.map(it => it.type === 'separator' ? { type: 'separator' } : ({
      label: it.label, accelerator: it.accelerator, enabled: it.enabled !== false, click: () => { chosen = it.id; }
    }));
    const menu = Menu.buildFromTemplate(build(items));
    menu.popup({ window: BrowserWindow.fromWebContents(e.sender), callback: () => setTimeout(() => resolve(chosen), 0) });
  }));
}

// ---------- menu ----------
function cmd(id) { return () => send('command', id); }

function rebuildMenu() {
  const about = () => dialog.showMessageBox(win, { type: 'info', title: 'Lezx Code', message: `Lezx Code ${app.getVersion()}`, detail: 'IDE leve para desenvolvimento web.\nhttps://github.com/Jvictorifran/LezxCode' });
  // no Windows os atalhos de edição ficam com o editor/terminal (Ctrl+C no terminal precisa continuar sendo "interromper")
  const editRole = (role, label) => ({ role, label, ...(IS_WIN ? { registerAccelerator: false } : {}) });
  const template = [
    {
      label: 'Lezx Code',
      submenu: [
        IS_MAC ? { role: 'about', label: 'Sobre o Lezx Code' } : { label: 'Sobre o Lezx Code', click: about },
        { type: 'separator' },
        { label: 'Configurações', accelerator: 'CmdOrCtrl+,', click: cmd('settings.open') },
        { label: 'Configurações (JSON)', click: cmd('settings.openJson') },
        { label: IS_MAC ? 'Tema de Cores… (⌘K ⌘T)' : 'Tema de Cores… (Ctrl+K Ctrl+T)', click: cmd('theme.pick') },
        { label: 'Tema de Ícones…', click: cmd('iconTheme.pick') },
        { label: 'Abrir pasta de temas', click: cmd('theme.openFolder') },
        ...(IS_MAC ? [
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide', label: 'Ocultar Lezx Code' },
          { role: 'hideOthers', label: 'Ocultar outros' },
          { role: 'unhide', label: 'Mostrar tudo' }
        ] : []),
        { type: 'separator' },
        { role: 'quit', label: 'Sair do Lezx Code' }
      ]
    },
    {
      label: 'Arquivo',
      submenu: [
        { label: 'Novo arquivo', accelerator: 'CmdOrCtrl+N', click: cmd('file.new') },
        { label: 'Abrir…', accelerator: 'CmdOrCtrl+O', click: cmd('file.openAny') },
        { label: 'Abrir pasta…', accelerator: 'CmdOrCtrl+Shift+O', click: cmd('folder.open') },
        {
          label: 'Abrir pasta recente',
          submenu: recentFolders().length
            ? [...recentFolders().map(p => ({ label: p.replace(app.getPath('home'), '~'), click: () => openPath(p) })), { type: 'separator' },
              { label: 'Limpar recentes', click: () => { saveState({ recentFolders: [] }); rebuildMenu(); } }]
            : [{ label: 'Nenhuma pasta recente', enabled: false }]
        },
        { type: 'separator' },
        { label: 'Salvar', accelerator: 'CmdOrCtrl+S', click: cmd('file.save') },
        { label: 'Salvar como…', accelerator: 'CmdOrCtrl+Shift+S', click: cmd('file.saveAs') },
        { label: 'Salvar tudo', accelerator: 'CmdOrCtrl+Alt+S', click: cmd('file.saveAll') },
        { type: 'separator' },
        { label: 'Fechar aba', accelerator: 'CmdOrCtrl+W', click: cmd('tab.close') },
        { label: 'Fechar pasta', click: cmd('folder.close') },
        { label: 'Fechar janela', accelerator: 'CmdOrCtrl+Shift+W', role: 'close' }
      ]
    },
    {
      label: 'Editar',
      submenu: [
        { label: 'Desfazer', accelerator: 'CmdOrCtrl+Z', registerAccelerator: !IS_WIN, click: cmd('edit.undo') },
        { label: 'Refazer', accelerator: IS_WIN ? 'Ctrl+Y' : 'CmdOrCtrl+Shift+Z', registerAccelerator: !IS_WIN, click: cmd('edit.redo') },
        { type: 'separator' },
        editRole('cut', 'Recortar'),
        editRole('copy', 'Copiar'),
        editRole('paste', 'Colar'),
        editRole('selectAll', 'Selecionar tudo'),
        { type: 'separator' },
        { label: 'Localizar', accelerator: 'CmdOrCtrl+F', click: cmd('edit.find') },
        { label: 'Substituir', accelerator: 'CmdOrCtrl+Alt+F', click: cmd('edit.replace') },
        { label: 'Pesquisar nos arquivos', accelerator: 'CmdOrCtrl+Shift+F', click: cmd('view.search') },
        { type: 'separator' },
        { label: 'Formatar documento', accelerator: 'Shift+Alt+F', click: cmd('editor.format') },
        { label: 'Comentar linha', accelerator: 'CmdOrCtrl+/', click: cmd('editor.comment') }
      ]
    },
    {
      label: 'Exibir',
      submenu: [
        { label: 'Paleta de comandos…', accelerator: 'CmdOrCtrl+Shift+P', click: cmd('palette.commands') },
        { label: 'Ir para arquivo…', accelerator: 'CmdOrCtrl+P', click: cmd('palette.files') },
        { label: 'Ir para linha…', accelerator: 'Ctrl+G', click: cmd('editor.gotoLine') },
        { type: 'separator' },
        { label: 'Explorador', accelerator: 'CmdOrCtrl+Shift+E', click: cmd('view.explorer') },
        { label: 'Alternar barra lateral', accelerator: 'CmdOrCtrl+B', click: cmd('view.toggleSidebar') },
        { label: 'Alternar terminal', accelerator: 'Ctrl+`', click: cmd('terminal.toggle') },
        { label: 'Alternar painel', accelerator: 'CmdOrCtrl+J', click: cmd('terminal.toggle') },
        { label: 'Novo terminal', accelerator: 'Ctrl+Shift+`', click: cmd('terminal.new') },
        { type: 'separator' },
        { label: 'Próxima aba', accelerator: 'Ctrl+Tab', click: cmd('tab.next') },
        { label: 'Aba anterior', accelerator: 'Ctrl+Shift+Tab', click: cmd('tab.prev') },
        { type: 'separator' },
        { label: 'Quebra de linha', accelerator: 'Alt+Z', click: cmd('editor.toggleWrap') },
        { label: 'Minimapa', click: cmd('editor.toggleMinimap') },
        { label: 'Aumentar fonte', accelerator: 'CmdOrCtrl+=', click: cmd('font.increase') },
        { label: 'Diminuir fonte', accelerator: 'CmdOrCtrl+-', click: cmd('font.decrease') },
        { label: 'Restaurar fonte', accelerator: 'CmdOrCtrl+0', click: cmd('font.reset') },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Tela cheia' },
        { role: 'toggleDevTools', label: 'Ferramentas de desenvolvedor', accelerator: 'CmdOrCtrl+Alt+I' },
        { role: 'reload', label: 'Recarregar janela', accelerator: 'CmdOrCtrl+Shift+R' }
      ]
    },
    {
      label: 'Extensões',
      submenu: [
        { label: 'Mostrar extensões', accelerator: 'CmdOrCtrl+Shift+X', click: cmd('view.extensions') },
        { label: 'Abrir pasta das minhas extensões', click: cmd('ext.openFolder') }
      ]
    },
    {
      label: 'Live Server',
      submenu: [
        { label: 'Go Live (abrir no navegador)', accelerator: 'CmdOrCtrl+Alt+L', click: cmd('live.start') },
        { label: 'Parar Live Server', accelerator: 'CmdOrCtrl+Alt+K', click: cmd('live.stop') }
      ]
    },
    { role: 'windowMenu', label: 'Janela' },
    {
      role: 'help', label: 'Ajuda',
      submenu: [{ label: IS_MAC ? 'Atalhos de teclado (⌘K ⌘S)' : 'Atalhos de teclado (Ctrl+K Ctrl+S)', click: cmd('help.shortcuts') }]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- janela ----------
function createWindow() {
  const bounds = loadState().bounds || { width: 1280, height: 820 };
  win = new BrowserWindow({
    ...bounds,
    minWidth: 600,
    minHeight: 400,
    title: 'Lezx Code',
    ...(IS_MAC
      ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 12, y: 10 } }
      : { titleBarStyle: 'hidden', titleBarOverlay: { color: '#16171c', symbolColor: '#9aa0b0', height: 36 }, icon: path.join(APP_DIR, 'build', 'icon.png') }),
    backgroundColor: '#1b1d23',
    show: false,
    webPreferences: {
      preload: path.join(APP_DIR, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });
  win.loadURL('lezx://app/index.html');
  win.once('ready-to-show', () => win.show());
  // modo de teste: LEZX_SHOT=arquivo.png salva uma captura da janela; LEZX_EVAL executa JS no renderer antes
  if (!app.isPackaged && process.env.LEZX_SHOT) {
    win.webContents.once('did-finish-load', () => setTimeout(async () => {
      if (process.env.LEZX_EVAL) { try { await win.webContents.executeJavaScript(fs.readFileSync(process.env.LEZX_EVAL, 'utf8')); } catch (e) { console.log('eval error', e.message); } }
      // LEZX_KEYS="Tab;Cmd+D;Cmd+D": teclas reais enviadas à janela, depois LEZX_EVAL2
      for (const combo of (process.env.LEZX_KEYS || '').split(';').filter(Boolean)) {
        const parts = combo.split('+');
        const keyCode = parts.pop();
        const modifiers = parts.map(m => ({ Cmd: 'meta', Shift: 'shift', Alt: 'alt', Ctrl: 'control' }[m]));
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
        if (keyCode.length === 1 && !modifiers.includes('meta')) win.webContents.sendInputEvent({ type: 'char', keyCode, modifiers });
        win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
        await new Promise(r => setTimeout(r, 400));
      }
      if (process.env.LEZX_EVAL2) { try { await win.webContents.executeJavaScript(fs.readFileSync(process.env.LEZX_EVAL2, 'utf8')); } catch (e) { console.log('eval2 error', e.message); } }
      setTimeout(async () => {
        fs.writeFileSync(process.env.LEZX_SHOT, (await win.webContents.capturePage()).toPNG());
        console.log('shot saved');
        if (process.env.LEZX_QUIT) app.exit(0);
      }, +(process.env.LEZX_WAIT || 1500));
    }, 2500));
  }
  if (!app.isPackaged) win.webContents.on('console-message', e => console.log(`[renderer:${e.level}] ${e.message} (${e.sourceId}:${e.lineNumber})`));

  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('lezx://')) { e.preventDefault(); shell.openExternal(url); } });

  let saveTimer = null;
  const saveBounds = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => { if (win && !win.isDestroyed() && !win.isFullScreen()) saveState({ bounds: win.getBounds() }); }, 500); };
  win.on('resize', saveBounds);
  win.on('move', saveBounds);

  win.on('close', e => {
    if (dirtyCount > 0) {
      const r = dialog.showMessageBoxSync(win, {
        type: 'warning', buttons: ['Sair sem salvar', 'Cancelar'], defaultId: 1, cancelId: 1,
        message: `Você tem ${dirtyCount} arquivo(s) com alterações não salvas.`, detail: 'Deseja sair mesmo assim?'
      });
      if (r !== 0) { e.preventDefault(); return; }
    }
    lsp.stopAll();
    for (const p of terminals.values()) { try { p.kill(); } catch {} }
    terminals.clear();
  });
  win.on('closed', () => { win = null; });
}

// abrir pasta passada via linha de comando: open -a "Lezx Code" pasta
let pendingOpen = null;
app.on('open-file', (e, p) => {
  e.preventDefault();
  if (win) openPath(p); else pendingOpen = p;
});

function openPath(p) {
  try {
    if (fs.statSync(p).isDirectory()) { setRoot(p); send('root:opened', p); }
    else send('file:openExternal', p);
  } catch {}
}

app.whenReady().then(() => {
  protocol.handle('lezx', req => {
    const { host, pathname } = new URL(req.url);
    const rel = decodeURIComponent(pathname).replace(/^\/+/, '');
    if (host === 'fonts') {
      const font = path.join(FONTS_DIR, path.basename(rel));
      return net.fetch(pathToFileURL(font).toString());
    }
    const file = path.normalize(path.join(APP_DIR, 'dist', rel));
    if (!file.startsWith(path.join(APP_DIR, 'dist'))) return new Response('forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });

  ensureUserDirs();
  migrateState();
  fontStore = createFontStore(FONTS_DIR);
  extensions = createExtensionManager({ appDir: APP_DIR, userDir: USER_DIR, readJSON, send });
  lsp.resolveLoginPath();
  registerIpc();
  watchUserDirs();
  nativeTheme.themeSource = 'dark';

  const argFolder = process.argv.slice(app.isPackaged ? 1 : 2).find(a => !a.startsWith('-') && fs.existsSync(a));
  const startFolder = pendingOpen || argFolder || loadState().lastFolder;
  if (startFolder && fs.existsSync(startFolder) && fs.statSync(startFolder).isDirectory()) setRoot(path.resolve(startFolder));
  else rebuildMenu();

  createWindow();
  if (pendingOpen && !fs.statSync(pendingOpen).isDirectory()) {
    const f = pendingOpen;
    win.webContents.once('did-finish-load', () => setTimeout(() => send('file:openExternal', f), 600));
  }
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});

app.on('window-all-closed', () => {
  liveServer.stop();
  app.quit();
});
