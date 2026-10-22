// Lezx Code — ponto de entrada do renderer
import '@xterm/xterm/css/xterm.css';
import './styles.css';
import { api, $, $$, h, IS_MAC, localizeKeys, basename, dirname, relative, toast, errorToast, makeSash, store } from './ui.js';
import { state, on, emit } from './state.js';
import { applyTheme } from './themes.js';
import { applyIconTheme, fileIcon } from './icons.js';
import * as ed from './editor.js';
import * as explorer from './explorer.js';
import { initTerminal, newTerminal, togglePanel, isPanelOpen, killTerminal, runInTerminal } from './terminal.js';
import { initExtensions } from './extensions.js';
import { initShortcuts } from './shortcuts.js';
import { initErrorLens } from './error-lens.js';
import { initTranslations } from './translate.js';
import { initPalette, openPalette, paletteOpen, closePalette } from './palette.js';
import { initSearch, focusSearch } from './search.js';
import { initSettingsUI } from './settings-ui.js';
import { loadUserFonts } from './fonts.js';

const { monaco } = ed;

// ---------------- comandos ----------------
const commands = [];
function cmd(id, label, run, key, group) { commands.push({ id, label, run, key, group }); }

const editorAction = id => () => { const a = ed.editor.getAction(id); if (a && ed.activeTab()?.kind === 'text') { ed.editor.focus(); a.run(); } };
const inEditor = () => ed.editor.hasTextFocus() || ed.editor.hasWidgetFocus();

cmd('palette.commands', 'Mostrar todos os comandos', () => openCommands(), '⇧⌘P');
cmd('palette.files', 'Ir para arquivo…', () => openFiles(), '⌘P');
cmd('file.new', 'Arquivo: Novo arquivo', () => ed.newUntitled(), '⌘N', 'Arquivo');
cmd('file.newInFolder', 'Arquivo: Novo arquivo no explorador', () => { showView('explorer'); explorer.startNew('new-file'); }, null, 'Arquivo');
cmd('folder.newInFolder', 'Arquivo: Nova pasta no explorador', () => { showView('explorer'); explorer.startNew('new-folder'); }, null, 'Arquivo');
cmd('file.openAny', 'Arquivo: Abrir arquivo ou pasta…', openAnyDialog, '⌘O', 'Arquivo');
cmd('file.open', 'Arquivo: Abrir arquivo…', async () => { for (const f of await api.invoke('dialog:openFile')) await ed.openFile(f); }, null, 'Arquivo');
cmd('folder.open', 'Arquivo: Abrir pasta…', openFolderDialog, '⇧⌘O', 'Arquivo');
cmd('folder.recent', 'Arquivo: Abrir pasta recente…', pickRecentFolder, null, 'Arquivo');
cmd('folder.close', 'Arquivo: Fechar pasta', closeFolder, null, 'Arquivo');
cmd('file.save', 'Arquivo: Salvar', () => ed.save(), '⌘S', 'Arquivo');
cmd('file.saveAs', 'Arquivo: Salvar como…', () => ed.save(undefined, { as: true }), '⇧⌘S', 'Arquivo');
cmd('file.saveAll', 'Arquivo: Salvar tudo', () => ed.saveAll(), '⌥⌘S', 'Arquivo');
cmd('tab.close', 'Exibir: Fechar aba', () => { if (paletteOpen()) closePalette(); else ed.closeTab(); }, '⌘W', 'Exibir');
cmd('tab.closeAll', 'Exibir: Fechar todas as abas', () => ed.closeMany([...ed.tabs]), null, 'Exibir');
cmd('tab.next', 'Exibir: Próxima aba', () => ed.cycleTab(1), '⌃Tab', 'Exibir');
cmd('tab.prev', 'Exibir: Aba anterior', () => ed.cycleTab(-1), '⌃⇧Tab', 'Exibir');
cmd('file.revealActive', 'Arquivo: Revelar arquivo ativo no explorador', () => { const t = ed.activeTab(); if (t?.path) { showView('explorer'); explorer.reveal(t.path); } }, null, 'Arquivo');
cmd('file.openInBrowser', 'Arquivo: Abrir no navegador padrão', () => { const t = ed.activeTab(); if (t?.path) api.invoke('shell:openPath', t.path); }, null, 'Arquivo');
cmd('file.revealFinder', 'Arquivo: Mostrar no Finder', () => { const t = ed.activeTab(); if (t?.path) api.invoke('shell:reveal', t.path); }, null, 'Arquivo');
cmd('file.copyPath', 'Arquivo: Copiar caminho do arquivo ativo', () => { const t = ed.activeTab(); if (t?.path) navigator.clipboard.writeText(t.path); }, null, 'Arquivo');

cmd('view.explorer', 'Exibir: Explorador', () => showView('explorer', true), '⇧⌘E', 'Exibir');
cmd('view.search', 'Exibir: Pesquisar nos arquivos', () => { showView('search', true); focusSearch(selectedText()); }, '⇧⌘F', 'Exibir');
cmd('view.extensions', 'Exibir: Extensões', () => { showView('extensions', true); $('#ext-search').focus(); }, '⇧⌘X', 'Exibir');
cmd('ext.openFolder', 'Extensões: Abrir pasta das minhas extensões', () => api.invoke('ext:openFolder'), null, 'Extensões');
cmd('ext.editExample', 'Extensões: Criar minha extensão (editar exemplo)', () => ed.openFile(`${state.info.userDir}/extensions/exemplo-minha-extensao.json`), null, 'Extensões');
cmd('help.shortcuts', 'Ajuda: Atalhos de teclado', () => ed.openSpecial('shortcuts', 'Atalhos de teclado'), '⌘K ⌘S', 'Ajuda');
cmd('terminal.run', 'Terminal: Executar comando', c => typeof c === 'string' && runInTerminal(c), null, 'Terminal');
cmd('file.openPath', 'Arquivo: Abrir caminho', p => typeof p === 'string' && ed.openFile(p), null, 'Arquivo');
cmd('view.toggleSidebar', 'Exibir: Alternar barra lateral', toggleSidebar, '⌘B', 'Exibir');
cmd('terminal.toggle', 'Terminal: Alternar terminal', togglePanel, '⌃`', 'Terminal');
cmd('terminal.new', 'Terminal: Novo terminal', () => newTerminal(), '⌃⇧`', 'Terminal');
cmd('terminal.kill', 'Terminal: Encerrar terminal ativo', () => killTerminal(), null, 'Terminal');
cmd('terminal.newAt', 'Terminal: Novo terminal na pasta do arquivo', dir => { const t = ed.activeTab(); newTerminal(typeof dir === 'string' ? dir : t?.path ? dirname(t.path) : state.root); }, null, 'Terminal');

cmd('live.start', 'Live Server: Go Live (abrir no navegador)', () => startLive(), '⌥⌘L', 'Live Server');
cmd('live.startFile', 'Live Server: Abrir arquivo atual', file => startLive(typeof file === 'string' ? file : undefined), null, 'Live Server');
cmd('live.stop', 'Live Server: Parar', () => api.invoke('live:stop'), '⌥⌘K', 'Live Server');
cmd('live.open', 'Live Server: Abrir no navegador novamente', () => { if (state.live.running) api.invoke('shell:openExternal', `http://localhost:${state.live.port}/`); }, null, 'Live Server');

cmd('theme.pick', 'Preferências: Tema de cores', pickTheme, '⌘K ⌘T', 'Preferências');
cmd('iconTheme.pick', 'Preferências: Tema de ícones', pickIconTheme, null, 'Preferências');
cmd('theme.openFolder', 'Preferências: Abrir pasta dos meus temas', () => api.invoke('shell:openPath', state.info.themesDir), null, 'Preferências');
cmd('theme.openIconFolder', 'Preferências: Abrir pasta dos meus temas de ícones', () => api.invoke('shell:openPath', state.info.iconThemesDir), null, 'Preferências');
cmd('theme.new', 'Preferências: Criar novo tema de cores', createTheme, null, 'Preferências');
cmd('theme.editCurrent', 'Preferências: Editar o exemplo de tema (JSON)', () => ed.openFile(`${state.info.themesDir}/exemplo-meu-tema.json`), null, 'Preferências');
cmd('iconTheme.editExample', 'Preferências: Editar o exemplo de tema de ícones (JSON)', () => ed.openFile(`${state.info.iconThemesDir}/exemplo-meus-icones.json`), null, 'Preferências');
cmd('settings.open', 'Preferências: Configurações', () => ed.openSpecial('settings', 'Configurações'), '⌘,', 'Preferências');
cmd('settings.openJson', 'Preferências: Abrir configurações (JSON)', () => ed.openFile(state.info.settingsFile), null, 'Preferências');
cmd('settings.fonts', 'Preferências: Importar fontes…', async () => { const a = await api.invoke('fonts:import'); if (a.length) { await loadUserFonts(); toast(`${a.length} fonte(s) importada(s). Escolha em Configurações > Fontes.`); } }, null, 'Preferências');
cmd('sidebar.toggleSide', 'Exibir: Mover barra lateral para o outro lado', () => api.invoke('settings:set', { 'workbench.sideBar.location': state.settings['workbench.sideBar.location'] === 'right' ? 'left' : 'right' }), null, 'Exibir');
cmd('font.increase', 'Preferências: Aumentar fonte', () => zoomFont(1), '⌘=', 'Preferências');
cmd('font.decrease', 'Preferências: Diminuir fonte', () => zoomFont(-1), '⌘-', 'Preferências');
cmd('font.reset', 'Preferências: Restaurar tamanho da fonte', () => api.invoke('settings:set', { 'editor.fontSize': 14, 'terminal.fontSize': 13 }), '⌘0', 'Preferências');
cmd('autosave.toggle', 'Preferências: Alternar salvamento automático', () => {
  const on = state.settings['files.autoSave'] !== 'off';
  api.invoke('settings:set', { 'files.autoSave': on ? 'off' : 'afterDelay' });
  toast(`Salvamento automático ${on ? 'desativado' : 'ativado'}`);
}, null, 'Preferências');
cmd('translations.edit', 'Preferências: Editar minhas traduções de erros', async () => ed.openFile(`${await api.invoke('translations:dir')}/minhas-traducoes.json`), null, 'Preferências');
cmd('translations.toggle', 'Preferências: Alternar tradução dos erros', () => api.invoke('settings:set', { 'editor.translateErrors': !state.settings['editor.translateErrors'] }), null, 'Preferências');
cmd('errorLens.toggle', 'Editor: Alternar erros na linha', () => {
  const v = state.settings['editor.errorLens'] === 'off' ? 'all' : 'off';
  api.invoke('settings:set', { 'editor.errorLens': v });
  toast(`Erros na linha ${v === 'off' ? 'desligados' : 'ligados'}`);
}, null, 'Editor');
cmd('formatOnSave.toggle', 'Preferências: Alternar formatar ao salvar', () => {
  const v = !state.settings['editor.formatOnSave'];
  api.invoke('settings:set', { 'editor.formatOnSave': v });
  toast(`Formatar ao salvar ${v ? 'ativado' : 'desativado'}`);
}, null, 'Preferências');

cmd('editor.format', 'Editor: Formatar documento', editorAction('editor.action.formatDocument'), '⇧⌥F', 'Editor');
cmd('editor.comment', 'Editor: Comentar linha', editorAction('editor.action.commentLine'), '⌘/', 'Editor');
cmd('editor.gotoLine', 'Editor: Ir para linha…', editorAction('editor.action.gotoLine'), '⌃G', 'Editor');
cmd('editor.symbols', 'Editor: Ir para símbolo…', editorAction('editor.action.quickOutline'), null, 'Editor');
cmd('editor.toggleWrap', 'Editor: Alternar quebra de linha', () => api.invoke('settings:set', { 'editor.wordWrap': state.settings['editor.wordWrap'] === 'on' ? 'off' : 'on' }), '⌥Z', 'Editor');
cmd('editor.toggleMinimap', 'Editor: Alternar minimapa', () => api.invoke('settings:set', { 'editor.minimap': !state.settings['editor.minimap'] }), null, 'Editor');
cmd('editor.changeLanguage', 'Editor: Alterar linguagem do arquivo', pickLanguage, null, 'Editor');
cmd('editor.indent', 'Editor: Alterar indentação', pickIndent, null, 'Editor');
cmd('editor.foldAll', 'Editor: Recolher tudo', editorAction('editor.foldAll'), null, 'Editor');
cmd('editor.unfoldAll', 'Editor: Expandir tudo', editorAction('editor.unfoldAll'), null, 'Editor');
cmd('editor.emmetWrap', 'Emmet: Envolver com abreviação', wrapWithAbbreviation, null, 'Editor');
cmd('edit.undo', 'Editar: Desfazer', () => inEditor() ? ed.editor.trigger('menu', 'undo') : document.execCommand('undo'), '⌘Z', 'Editar');
cmd('edit.redo', 'Editar: Refazer', () => inEditor() ? ed.editor.trigger('menu', 'redo') : document.execCommand('redo'), '⇧⌘Z', 'Editar');
cmd('edit.find', 'Editar: Localizar', () => { if (ed.activeTab()?.kind === 'text') editorAction('actions.find')(); }, '⌘F', 'Editar');
cmd('edit.replace', 'Editar: Substituir', editorAction('editor.action.startFindReplaceAction'), '⌥⌘F', 'Editar');
cmd('cli.install', 'Terminal: Instalar o comando "lezx" no PATH', async () => { const r = await api.invoke('cli:install'); toast(r.message); }, null, 'Terminal');
cmd('window.reload', 'Desenvolvedor: Recarregar janela', () => location.reload(), '⇧⌘R', 'Desenvolvedor');

function runCommand(id, ...args) {
  const c = commands.find(x => x.id === id);
  if (!c) return console.warn('comando desconhecido', id);
  Promise.resolve().then(() => c.run(...args)).catch(errorToast);
}

// ---------------- paleta ----------------
const recentCmds = store.get('recentCommands', []);

function openCommands(value = '>') {
  const list = () => {
    const rec = recentCmds.map(id => commands.find(c => c.id === id)).filter(Boolean).map(c => ({ ...c, group: 'usados recentemente' }));
    const rest = commands.filter(c => !recentCmds.includes(c.id) && !c.id.startsWith('palette.')).map(c => ({ ...c, group: 'outros comandos' }));
    return [...rec, ...rest];
  };
  openPalette({
    placeholder: 'Digite o nome de um comando', value, prefix: '>', items: list,
    onInput: q => { if (!q.startsWith('>')) { openFiles(q); return false; } },
    onSelect: c => {
      const i = recentCmds.indexOf(c.id); if (i >= 0) recentCmds.splice(i, 1);
      recentCmds.unshift(c.id); recentCmds.length = Math.min(recentCmds.length, 6); store.set('recentCommands', recentCmds);
      runCommand(c.id);
    }
  });
}

let fileCache = null;
async function openFiles(value = '') {
  const recent = ed.tabs.filter(t => t.path).map(t => t.path);
  const build = () => {
    const seen = new Set();
    const out = [];
    for (const p of [...recent, ...(fileCache || [])]) {
      if (seen.has(p)) continue; seen.add(p);
      out.push({ path: p, label: basename(p), description: relative(state.root, dirname(p)), icon: fileIcon(basename(p)), group: recent.includes(p) ? 'abertos recentemente' : 'arquivos' });
    }
    return out;
  };
  openPalette({
    placeholder: state.root ? 'Pesquisar arquivos por nome (digite > para comandos, : para ir à linha)' : 'Abra uma pasta para pesquisar arquivos (> para comandos)',
    value, items: build, emptyText: fileCache ? 'Nenhum arquivo encontrado' : 'Carregando arquivos…',
    onInput: q => {
      if (q.startsWith('>')) { openCommands(q); return false; }
      if (q.startsWith(':')) { goToLinePalette(q); return false; }
    },
    onSelect: it => it && ed.openFile(it.path)
  });
  if (!fileCache && state.root) {
    fileCache = await api.invoke('search:files', state.root);
    if (paletteOpen()) openFiles($('#palette-input').value);
  }
}

function goToLinePalette(q) {
  const tab = ed.activeTab();
  openPalette({
    value: q, filter: false, acceptEmpty: true,
    placeholder: 'Ir para linha', emptyText: tab?.kind === 'text' ? `Digite uma linha entre 1 e ${tab.model.getLineCount()}` : 'Nenhum editor ativo',
    onInput: v => { if (!v.startsWith(':')) { openFiles(v); return false; } },
    items: v => {
      const [line, col] = v.slice(1).split(/[:,]/).map(Number);
      return line && tab?.kind === 'text' ? [{ label: `Ir para a linha ${line}${col ? `, coluna ${col}` : ''}`, line, col }] : [];
    },
    onSelect: it => {
      if (!it) return;
      ed.editor.setPosition({ lineNumber: it.line, column: it.col || 1 });
      ed.editor.revealLineInCenter(it.line);
      ed.editor.focus();
    }
  });
}

async function pickTheme() {
  const list = await api.invoke('themes:list');
  const original = state.settings['workbench.colorTheme'];
  const items = list.map(t => ({ label: t.name, id: t.id, description: t.source === 'user' ? 'meu tema' : t.type === 'light' ? 'claro' : 'escuro', picked: t.id === original, group: t.type === 'light' ? 'temas claros' : 'temas escuros' }))
    .sort((a, b) => a.group.localeCompare(b.group));
  openPalette({
    placeholder: 'Selecione o tema de cores (↑↓ para pré-visualizar)', items,
    onHighlight: it => it && applyTheme(it.id),
    onCancel: () => applyTheme(original),
    onSelect: it => api.invoke('settings:set', { 'workbench.colorTheme': it.id })
  });
}

async function pickIconTheme() {
  const list = await api.invoke('iconThemes:list');
  const original = state.settings['workbench.iconTheme'];
  openPalette({
    placeholder: 'Selecione o tema de ícones', items: list.map(t => ({ label: t.name, id: t.id, description: t.source === 'user' ? 'meu tema' : '', picked: t.id === original })),
    onHighlight: it => it && applyIconTheme(it.id),
    onCancel: () => applyIconTheme(original),
    onSelect: it => api.invoke('settings:set', { 'workbench.iconTheme': it.id })
  });
}

async function createTheme() {
  openPalette({
    placeholder: 'Nome do novo tema (ex.: Meu Tema Roxo) e Enter', filter: false, acceptEmpty: true, items: [],
    emptyText: 'Será criado com base no tema atual — edite o JSON e salve para ver as mudanças na hora',
    onSelect: async (_it, name) => {
      name = name.trim(); if (!name) return;
      const base = await api.invoke('themes:read', state.settings['workbench.colorTheme']);
      const theme = { name, type: base.type || 'dark', colors: base.colors || {}, tokenColors: base.tokenColors, tokens: base.tokens };
      const file = `${state.info.themesDir}/${name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-')}.json`;
      await api.invoke('fs:writeFile', file, JSON.stringify(theme, null, 2));
      await api.invoke('settings:set', { 'workbench.colorTheme': name });
      ed.openFile(file);
      toast(`Tema "${name}" criado. Edite e salve (⌘S) para aplicar na hora.`);
    }
  });
}

function pickLanguage() {
  const tab = ed.activeTab();
  if (tab?.kind !== 'text') return;
  const cur = tab.model.getLanguageId();
  openPalette({
    placeholder: 'Selecione a linguagem do arquivo',
    items: ed.languages().map(l => ({ label: l.aliases?.[0] || l.id, description: l.id, id: l.id, picked: l.id === cur })),
    onSelect: it => ed.setLanguage(it.id)
  });
}

function pickIndent() {
  const tab = ed.activeTab();
  if (tab?.kind !== 'text') return;
  const items = [2, 4, 8].flatMap(n => [{ label: `Espaços: ${n}`, spaces: true, n }, { label: `Tabs: ${n}`, spaces: false, n }]);
  openPalette({
    placeholder: 'Indentação deste arquivo', items: [...items, { label: 'Converter indentação para espaços', act: 'editor.action.indentationToSpaces' }, { label: 'Converter indentação para tabs', act: 'editor.action.indentationToTabs' }],
    onSelect: it => { if (it.act) editorAction(it.act)(); else { tab.model.updateOptions({ tabSize: it.n, insertSpaces: it.spaces }); emit('cursor'); } }
  });
}

function wrapWithAbbreviation() {
  const sel = ed.editor.getSelection();
  if (!sel || sel.isEmpty()) return toast('Selecione um trecho primeiro');
  openPalette({
    placeholder: 'Abreviação Emmet (ex.: div.card, ul>li, section#hero)', filter: false, acceptEmpty: true, items: [],
    onSelect: (_i, abbr) => {
      const m = abbr.trim().match(/^([a-z][\w-]*)?((?:[.#][\w-]+)*)$/i);
      if (!m) return toast('Use uma abreviação simples: tag.classe#id', 'warn');
      const tag = m[1] || 'div';
      const cls = [...m[2].matchAll(/\.([\w-]+)/g)].map(x => x[1]);
      const id = m[2].match(/#([\w-]+)/)?.[1];
      const attrs = (id ? ` id="${id}"` : '') + (cls.length ? ` class="${cls.join(' ')}"` : '');
      const text = ed.editor.getModel().getValueInRange(sel);
      ed.editor.executeEdits('emmet', [{ range: sel, text: `<${tag}${attrs}>${text}</${tag}>` }]);
    }
  });
}

function selectedText() {
  const sel = ed.editor.getSelection();
  if (!sel || sel.isEmpty() || sel.startLineNumber !== sel.endLineNumber) return '';
  return ed.editor.getModel()?.getValueInRange(sel) || '';
}

function zoomFont(d) {
  const s = state.settings;
  api.invoke('settings:set', { 'editor.fontSize': Math.max(8, s['editor.fontSize'] + d), 'terminal.fontSize': Math.max(8, s['terminal.fontSize'] + d) });
}

// ---------------- pasta ----------------
async function openAnyDialog() {
  const { folder, files } = await api.invoke('dialog:openAny');
  if (folder) await openRoot(folder);
  for (const f of files) await ed.openFile(f);
}

async function pickRecentFolder() {
  const list = await api.invoke('state:recentFolders');
  const home = state.info.home;
  openPalette({
    placeholder: 'Selecione uma pasta recente', emptyText: 'Nenhuma pasta recente — use ⇧⌘O para abrir uma',
    items: list.map(p => ({ label: basename(p), description: p.replace(home, '~'), path: p, icon: h('i', { class: 'codicon codicon-folder' }) })),
    onSelect: async it => { await api.invoke('root:set', it.path); await openRoot(it.path); }
  });
}

async function renderWelcome() {
  const box = $('#welcome-recent');
  const list = (await api.invoke('state:recentFolders')).slice(0, 6);
  box.hidden = !list.length;
  $('#welcome-recent-list').replaceChildren(...list.map(p => h('li', {},
    h('a', { href: '#', onclick: async e => { e.preventDefault(); await api.invoke('root:set', p); await openRoot(p); } }, basename(p)),
    h('span', { class: 'path' }, dirname(p).replace(state.info.home, '~')))));
}

async function openFolderDialog() {
  const dir = await api.invoke('dialog:openFolder');
  if (dir) await openRoot(dir);
}

async function openRoot(dir) {
  saveSession();
  if (!(await ed.closeMany([...ed.tabs]))) return;
  fileCache = null;
  await explorer.setRoot(dir);
  showView('explorer');
  await restoreSession();
  updateBranch();
  renderWelcome();
}

async function closeFolder() {
  saveSession();
  if (!(await ed.closeMany([...ed.tabs]))) return;
  await api.invoke('root:set', null);
  fileCache = null;
  await explorer.setRoot(null);
  updateBranch();
  renderWelcome();
}

function saveSession() {
  if (!state.root) return;
  store.set('session:' + state.root, { files: ed.tabs.filter(t => t.path).map(t => t.path), active: ed.activeTab()?.path });
}

async function restoreSession() {
  const s = store.get('session:' + state.root, null);
  if (!s) return;
  for (const f of s.files) if (await api.invoke('fs:exists', f)) await ed.openFile(f, { preserveFocus: true });
  const act = ed.tabs.find(t => t.path === s.active);
  if (act) ed.activate(act);
}

// ---------------- live server ----------------
async function startLive(file) {
  let root = state.root;
  const t = ed.activeTab();
  file ??= t?.path && /\.html?$/i.test(t.path) ? t.path : undefined;
  if (!root && t?.path) root = dirname(t.path);
  if (!root) return toast('Abra uma pasta ou um arquivo HTML para usar o Live Server', 'warn');
  if (t?.dirty && t.path) await ed.save(t);
  try {
    const r = await api.invoke('live:start', root, file);
    toast(`Live Server rodando em http://localhost:${r.port}`);
  } catch (e) { errorToast(e); }
}

function setLiveStatus(s) {
  state.live = s;
  const el = $('#sb-live');
  el.classList.toggle('running', !!s.running);
  el.title = s.running ? 'Clique para parar o Live Server' : 'Iniciar Live Server (⌥⌘L)';
  el.querySelector('span').textContent = s.running ? `Porta: ${s.port}` : 'Go Live';
  el.querySelector('i').className = `codicon codicon-${s.running ? 'circle-slash' : 'broadcast'}`;
}

// ---------------- barra de status ----------------
const EOL_LABEL = { 1: 'LF', 2: 'CRLF' };
function updateStatus() {
  const tab = ed.activeTab();
  const text = tab?.kind === 'text';
  for (const id of ['sb-cursor', 'sb-indent', 'sb-encoding', 'sb-eol', 'sb-lang']) $('#' + id).hidden = !text;
  if (!text) return;
  const pos = ed.editor.getPosition();
  const sel = ed.editor.getSelection();
  const selLen = sel && !sel.isEmpty() ? tab.model.getValueInRange(sel).length : 0;
  $('#sb-cursor').textContent = pos ? `Ln ${pos.lineNumber}, Col ${pos.column}${selLen ? ` (${selLen} selecionados)` : ''}` : '';
  const o = tab.model.getOptions();
  $('#sb-indent').textContent = `${o.insertSpaces ? 'Espaços' : 'Tabs'}: ${o.tabSize}`;
  $('#sb-eol').textContent = tab.model.getEOL() === '\r\n' ? EOL_LABEL[2] : EOL_LABEL[1];
  const lang = ed.languages().find(l => l.id === tab.model.getLanguageId());
  $('#sb-lang').textContent = lang?.aliases?.[0] || tab.model.getLanguageId();
}

function updateMarkers() {
  const ms = ed.markers();
  $('#sb-errors').textContent = ms.filter(m => m.severity === monaco.MarkerSeverity.Error).length;
  $('#sb-warnings').textContent = ms.filter(m => m.severity === monaco.MarkerSeverity.Warning).length;
}

async function updateBranch() {
  const el = $('#sb-branch');
  if (!state.root) { el.hidden = true; return; }
  try {
    if (!(await api.invoke('fs:exists', `${state.root}/.git/HEAD`))) { el.hidden = true; return; }
    const head = await api.invoke('fs:readFile', `${state.root}/.git/HEAD`);
    const m = head.content.match(/ref: refs\/heads\/(.+)/);
    el.querySelector('span').textContent = m ? m[1].trim() : head.content.slice(0, 7);
    el.hidden = false;
  } catch { el.hidden = true; }
}

// ---------------- layout ----------------
function showView(name, toggle = false) {
  const sb = $('#sidebar');
  const btn = $(`.act[data-view="${name}"]`);
  if (toggle && btn.classList.contains('active') && !sb.classList.contains('collapsed') && name !== 'search') { toggleSidebar(); return; }
  sb.classList.remove('collapsed');
  $('#sash-sidebar').hidden = false;
  $$('.act[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  $('#view-explorer').hidden = name !== 'explorer';
  $('#view-search').hidden = name !== 'search';
  $('#view-extensions').hidden = name !== 'extensions';
  if (name === 'explorer') $('#tree').focus();
}

function toggleSidebar() {
  const sb = $('#sidebar');
  sb.classList.toggle('collapsed');
  $('#sash-sidebar').hidden = sb.classList.contains('collapsed');
  store.set('sidebarCollapsed', sb.classList.contains('collapsed'));
}

function initLayout() {
  const sb = $('#sidebar');
  sb.style.width = store.get('sidebarWidth', 260) + 'px';
  if (store.get('sidebarCollapsed', false)) { sb.classList.add('collapsed'); $('#sash-sidebar').hidden = true; }
  const right = () => document.body.classList.contains('sidebar-right');
  makeSash($('#sash-sidebar'), {
    axis: 'x', get: () => (right() ? -1 : 1) * sb.offsetWidth,
    set: v => { sb.style.width = Math.max(160, Math.min(window.innerWidth - 300, right() ? -v : v)) + 'px'; },
    onEnd: () => store.set('sidebarWidth', sb.offsetWidth)
  });
  $$('.act[data-view]').forEach(b => b.addEventListener('click', () => b.dataset.view === 'search' ? runCommand('view.search') : showView(b.dataset.view, true)));
  $('#act-settings').addEventListener('click', async () => {
    const id = await api.invoke('menu:context', [
      { id: 'settings.open', label: 'Configurações' }, { id: 'settings.openJson', label: 'Configurações (JSON)' }, { type: 'separator' },
      { id: 'settings.fonts', label: 'Importar fontes…' }, { id: 'sidebar.toggleSide', label: `Barra lateral à ${state.settings['workbench.sideBar.location'] === 'right' ? 'esquerda' : 'direita'}` }, { type: 'separator' },
      { id: 'theme.pick', label: 'Tema de cores…' }, { id: 'iconTheme.pick', label: 'Tema de ícones…' }, { type: 'separator' },
      { id: 'autosave.toggle', label: `Salvamento automático: ${state.settings['files.autoSave'] === 'off' ? 'desligado' : 'ligado'}` },
      { id: 'formatOnSave.toggle', label: `Formatar ao salvar: ${state.settings['editor.formatOnSave'] ? 'ligado' : 'desligado'}` },
      { type: 'separator' }, { id: 'palette.commands', label: 'Paleta de comandos…' }
    ]);
    if (id) runCommand(id);
  });
  $('#act-themes').addEventListener('click', async () => {
    const id = await api.invoke('menu:context', [
      { id: 'theme.pick', label: 'Tema de cores…' }, { id: 'iconTheme.pick', label: 'Tema de ícones…' }, { type: 'separator' },
      { id: 'theme.new', label: 'Criar novo tema de cores…' }, { id: 'theme.editCurrent', label: 'Editar exemplo de tema' },
      { id: 'iconTheme.editExample', label: 'Editar exemplo de tema de ícones' }, { type: 'separator' },
      { id: 'theme.openFolder', label: 'Abrir pasta dos meus temas' }, { id: 'theme.openIconFolder', label: 'Abrir pasta dos meus temas de ícones' }
    ]);
    if (id) runCommand(id);
  });
  document.addEventListener('click', e => { const c = e.target.closest('[data-cmd]'); if (c) runCommand(c.dataset.cmd); });
  $('#app-menu').addEventListener('click', e => { const r = e.currentTarget.getBoundingClientRect(); api.send('menu:app', Math.round(r.left), Math.round(r.bottom)); });
  $('#sb-live').addEventListener('click', () => runCommand(state.live.running ? 'live.stop' : 'live.start'));
  $('#sb-lang').addEventListener('click', pickLanguage);
  $('#sb-indent').addEventListener('click', pickIndent);
  $('#sb-cursor').addEventListener('click', () => runCommand('editor.gotoLine'));
  $('#sb-eol').addEventListener('click', () => {
    const m = ed.activeTab()?.model; if (!m) return;
    m.pushEOL(m.getEOL() === '\n' ? monaco.editor.EndOfLineSequence.CRLF : monaco.editor.EndOfLineSequence.LF); updateStatus();
  });
  $('#sb-problems').addEventListener('click', () => editorAction('editor.action.marker.next')());
  document.addEventListener('lezx:focus-editor', () => { if (ed.activeTab()?.kind === 'text' && !isPanelOpenFocused()) ed.editor.focus(); });

  // arrastar arquivos/pastas do Finder para a janela
  document.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });
  document.addEventListener('drop', async e => {
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    for (const f of e.dataTransfer.files) {
      const p = api.pathForFile(f);
      if (!p) continue;
      try {
        const isDir = (await api.invoke('fs:readDir', p).then(() => true, () => false));
        if (isDir) { await api.invoke('root:set', p); await openRoot(p); break; }
        await ed.openFile(p);
      } catch (err) { errorToast(err); }
    }
  });
}
const isPanelOpenFocused = () => isPanelOpen() && $('#panel').contains(document.activeElement);

// ---------------- configurações ----------------
function applyWorkbench(s) {
  document.body.classList.toggle('sidebar-right', s['workbench.sideBar.location'] === 'right');
  const root = document.documentElement.style;
  root.setProperty('--ui-font', s['workbench.fontFamily']);
  root.setProperty('--ui-size', (s['workbench.fontSize'] || 13) + 'px');
}

async function applySettings(s, first = false) {
  const prev = state.settings;
  state.settings = s;
  applyWorkbench(s);
  if (first || prev['workbench.colorTheme'] !== s['workbench.colorTheme']) await applyTheme(s['workbench.colorTheme']);
  if (first || prev['workbench.iconTheme'] !== s['workbench.iconTheme']) await applyIconTheme(s['workbench.iconTheme']);
  if (!first && JSON.stringify(prev['files.exclude']) !== JSON.stringify(s['files.exclude'])) { fileCache = null; explorer.refresh(); }
  emit('settings', s);
}

// ---------------- início ----------------
async function boot() {
  state.info = await api.invoke('app:info');
  const settings = await api.invoke('settings:get');
  document.body.classList.add(IS_MAC ? 'platform-mac' : 'platform-win');
  localizeKeys();
  await loadUserFonts();
  initTranslations();
  await applySettings(settings, true);
  ed.initEditor();
  initSettingsUI();
  initShortcuts();
  initErrorLens();
  explorer.initExplorer();
  initTerminal();
  initPalette();
  initSearch();
  initLayout();
  initExtensions();

  on('command', (id, ...args) => runCommand(id, ...args));
  on('cursor', updateStatus);
  on('activeTab', () => { updateStatus(); saveSession(); });
  on('markers', updateMarkers);
  on('saved', tab => {
    if (tab.path === state.info.settingsFile) {
      // validação imediata do JSON de configurações
      try { JSON.parse(tab.model.getValue().replace(/^\s*\/\/.*$/gm, '')); } catch { toast('settings.json tem um erro de sintaxe', 'error'); }
    }
  });

  api.on('command', id => runCommand(id));
  api.on('settings:changed', s => applySettings(s));
  api.on('themes:changed', async () => {
    await applyTheme(state.settings['workbench.colorTheme']);
    await applyIconTheme(state.settings['workbench.iconTheme']);
  });
  api.on('live:status', setLiveStatus);
  api.on('fs:changed', paths => { fileCache = null; explorer.refresh(paths); ed.onFsChanged(paths); });
  api.on('root:opened', dir => openRoot(dir));
  api.on('file:openExternal', f => ed.openFile(f));
  window.addEventListener('focus', updateBranch);
  window.addEventListener('beforeunload', saveSession);

  setLiveStatus(await api.invoke('live:status'));
  if (state.info.root) await openRoot(state.info.root);
  else await explorer.setRoot(null);
  renderWelcome();
  if (!state.info.hasPty) toast('Terminal indisponível neste sistema.', 'warn');
  document.body.classList.add('ready');
}

window.lezxRun = runCommand; // útil para depurar pelo DevTools (⌥⌘I)
window.lezxEditor = () => ed.editor;
boot().catch(e => { console.error(e); errorToast(e); });
