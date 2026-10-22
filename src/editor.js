// Editor (Monaco) + abas
import * as monaco from './gen/monaco-lite.js';
import { emmetHTML, emmetCSS } from 'emmet-monaco-es';
import { api, $, h, basename, dirname, relative, errorToast, toast, contextMenu } from './ui.js';
import { state, emit, on } from './state.js';
import { fileIcon, onIconThemeChange } from './icons.js';

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|bmp|ico|svg)$/i;
const MEDIA_EXT = /\.(mp4|webm|mov|mp3|wav|ogg)$/i;
const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr', '!doctype']);
const HTML_LANGS = new Set(['html', 'php', 'handlebars', 'twig', 'liquid', 'xml']);

self.MonacoEnvironment = {
  getWorker(_id, label) {
    const name = label === 'json' ? 'json'
      : ['css', 'scss', 'less'].includes(label) ? 'css'
      : ['html', 'handlebars', 'razor'].includes(label) ? 'html'
      : ['typescript', 'javascript'].includes(label) ? 'ts' : 'editor';
    return new Worker(new URL(`workers/${name}.worker.js`, location.href));
  }
};

export let editor = null;
export const tabs = [];
let active = null;
let untitledCount = 0;
let autoSaveTimer = null;

export const activeTab = () => active;

function configureLanguages() {
  const ts = monaco.typescript || monaco.languages.typescript;
  if (ts) {
    const opts = {
      target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.NodeJs,
      allowJs: true, checkJs: false, allowNonTsExtensions: true, jsx: ts.JsxEmit.Preserve, esModuleInterop: true
    };
    ts.javascriptDefaults.setCompilerOptions(opts);
    ts.typescriptDefaults.setCompilerOptions(opts);
    ts.javascriptDefaults.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: false });
    ts.typescriptDefaults.setDiagnosticsOptions({ noSemanticValidation: false, noSyntaxValidation: false, diagnosticCodesToIgnore: [2307, 2792, 7016, 2580, 2304] });
    ts.javascriptDefaults.setEagerModelSync(true);
    ts.typescriptDefaults.setEagerModelSync(true);
  }
  emmetHTML(monaco, ['html', 'php', 'handlebars', 'twig', 'liquid']);
  emmetCSS(monaco, ['css', 'scss', 'less']);
}

export function editorOptions(s = state.settings) {
  return {
    fontSize: s['editor.fontSize'],
    fontFamily: s['editor.fontFamily'],
    lineHeight: s['editor.lineHeight'] || 0,
    cursorStyle: s['editor.cursorStyle'],
    fontLigatures: !!s['editor.fontLigatures'],
    tabSize: s['editor.tabSize'],
    insertSpaces: s['editor.insertSpaces'],
    wordWrap: s['editor.wordWrap'],
    minimap: { enabled: !!s['editor.minimap'], renderCharacters: false, scale: 1 },
    lineNumbers: s['editor.lineNumbers'],
    cursorBlinking: s['editor.cursorBlinking'],
    renderWhitespace: s['editor.renderWhitespace'],
    bracketPairColorization: { enabled: !!s['editor.bracketPairColorization'] },
    guides: { bracketPairs: 'active', indentation: true },
    stickyScroll: { enabled: !!s['editor.stickyScroll'] },
    linkedEditing: true,
    smoothScrolling: true,
    cursorSmoothCaretAnimation: 'on',
    automaticLayout: true,
    scrollBeyondLastLine: false,
    padding: { top: 8 },
    fixedOverflowWidgets: true,
    colorDecorators: true,
    formatOnPaste: false,
    // sugestões enquanto digita: Tab ou Enter aceita; prefixos de snippet + Tab expandem direto
    suggest: { showStatusBar: false, preview: true, showWords: true, insertMode: 'insert', filterGraceful: true, localityBonus: true, snippetsPreventQuickSuggestions: false },
    quickSuggestions: { other: true, comments: false, strings: true },
    quickSuggestionsDelay: 10,
    suggestOnTriggerCharacters: true,
    acceptSuggestionOnEnter: 'on',
    tabCompletion: 'on',
    snippetSuggestions: 'inline',
    wordBasedSuggestions: 'currentDocument',
    suggestSelection: 'first',
    parameterHints: { enabled: true, cycle: true },
    inlineSuggest: { enabled: true },
    hover: { delay: 400 },
    definitionLinkOpensInPeek: false,
    mouseWheelZoom: true,
    dragAndDrop: true
  };
}

export function initEditor() {
  configureLanguages();
  editor = monaco.editor.create($('#editor'), { model: null, ...editorOptions() });

  editor.onDidChangeCursorPosition(() => emit('cursor'));
  editor.onDidChangeModel(() => emit('cursor'));
  editor.onDidChangeModelContent(e => {
    const tab = active;
    if (!tab) return;
    updateDirty(tab);
    if (state.settings['files.autoSave'] === 'afterDelay' && tab.path) {
      clearTimeout(autoSaveTimer);
      autoSaveTimer = setTimeout(() => { if (tab.dirty) save(tab); }, state.settings['files.autoSaveDelay'] || 1000);
    }
    autoCloseTag(e);
  });
  editor.onDidBlurEditorText(() => {
    if (state.settings['files.autoSave'] === 'onFocusChange') for (const t of tabs) if (t.dirty && t.path) save(t);
  });
  // ⌘K ⌘T (acordes não são suportados pelos menus nativos)
  editor.addCommand(monaco.KeyMod.chord(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK, monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyT), () => emit('command', 'theme.pick'));
  editor.addCommand(monaco.KeyMod.chord(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK, monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS), () => emit('command', 'help.shortcuts'));
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyD, () => editor.trigger('kb', 'editor.action.duplicateSelection'));
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyI, () => editor.trigger('kb', 'editor.action.triggerSuggest'));
  // "ir para definição" em outro arquivo: abre a aba correspondente
  monaco.editor.registerEditorOpener({
    openCodeEditor(_source, resource, selectionOrPosition) {
      if (resource.scheme !== 'file') return false;
      const p = selectionOrPosition;
      const line = p?.startLineNumber ?? p?.lineNumber, col = p?.startColumn ?? p?.column;
      openFile(resource.fsPath, line ? { line, col } : {});
      return true;
    }
  });
  window.addEventListener('keydown', e => {
    // ⌘K ⌘T fora do editor
    if (e.metaKey && e.key.toLowerCase() === 'k' && !editor.hasTextFocus()) {
      const next = ev => { window.removeEventListener('keydown', next, true); if (ev.metaKey && ev.key.toLowerCase() === 't') { ev.preventDefault(); emit('command', 'theme.pick'); } };
      setTimeout(() => window.addEventListener('keydown', next, true), 0);
    }
  });

  monaco.editor.onDidChangeMarkers(() => emit('markers'));
  onIconThemeChange(renderTabs);
  on('settings', s => editor.updateOptions(editorOptions(s)));
  on('fonts', () => { document.fonts.ready.then(() => monaco.editor.remeasureFonts()); });

  $('#tabs').addEventListener('wheel', e => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { $('#tabs').scrollLeft += e.deltaY; } }, { passive: true });
  renderTabs();
  showArea();
}

// fecha tags HTML automaticamente ao digitar ">"
function autoCloseTag(e) {
  const model = editor.getModel();
  if (!model || !HTML_LANGS.has(model.getLanguageId()) || e.isUndoing || e.isRedoing || e.changes.length !== 1) return;
  const ch = e.changes[0];
  if (ch.text !== '>') return;
  const pos = editor.getPosition();
  const before = model.getValueInRange({ startLineNumber: Math.max(1, pos.lineNumber - 5), startColumn: 1, endLineNumber: pos.lineNumber, endColumn: pos.column });
  const m = before.match(/<([a-zA-Z][\w:.-]*)(?:\s(?:[^<>"']|"[^"]*"|'[^']*')*)?>$/);
  if (!m || before.endsWith('/>') || VOID_TAGS.has(m[1].toLowerCase())) return;
  const after = model.getLineContent(pos.lineNumber).slice(pos.column - 1);
  if (after.startsWith(`</${m[1]}>`)) return;
  editor.executeEdits('autoclose', [{ range: new monaco.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column), text: `</${m[1]}>` }]);
  editor.setPosition(pos);
}

function updateDirty(tab) {
  if (tab.kind !== 'text') return;
  const dirty = tab.model.getAlternativeVersionId() !== tab.savedVersion;
  if (dirty !== tab.dirty) {
    tab.dirty = dirty;
    renderTabs();
    api.send('app:dirty', tabs.filter(t => t.dirty).length);
  }
}

function showArea() {
  const kind = active?.kind;
  $('#editor').style.visibility = kind === 'text' ? 'visible' : 'hidden';
  $('#media-preview').hidden = kind !== 'media';
  $('#settings-view').hidden = kind !== 'settings';
  $('#shortcuts-view').hidden = kind !== 'shortcuts';
  $('#welcome').hidden = !!active;
  emit('activeTab', active);
  updateTitle();
}

function updateTitle() {
  const parts = [];
  if (active) parts.push((active.dirty ? '● ' : '') + active.name);
  if (state.root) parts.push(basename(state.root));
  parts.push('Lezx Code');
  const t = parts.join(' — ');
  $('#title').textContent = t;
  api.send('app:title', t);
}

export async function openFile(path, opts = {}) {
  let tab = tabs.find(t => t.path === path);
  if (!tab) {
    if (IMAGE_EXT.test(path) && !opts.asText || MEDIA_EXT.test(path)) {
      tab = { kind: 'media', path, name: basename(path), dirty: false };
    } else {
      let data;
      try { data = await api.invoke('fs:readFile', path); } catch (e) { return errorToast(e); }
      if (data.binary) { toast(`${basename(path)} é um arquivo binário e não pode ser aberto no editor.`, 'warn'); return; }
      const uri = monaco.Uri.file(path);
      const model = monaco.editor.getModel(uri) || monaco.editor.createModel(data.content, undefined, uri);
      if (model.getValue() !== data.content) model.setValue(data.content);
      tab = { kind: 'text', path, name: basename(path), model, savedVersion: model.getAlternativeVersionId(), dirty: false, viewState: null };
    }
    const idx = active ? tabs.indexOf(active) + 1 : tabs.length;
    tabs.splice(idx, 0, tab);
  }
  await activate(tab);
  if (opts.line && tab.kind === 'text') {
    const range = new monaco.Range(opts.line, opts.col || 1, opts.line, (opts.col || 1) + (opts.len || 0));
    editor.setSelection(range);
    editor.revealRangeInCenterIfOutsideViewport(range);
  }
  if (tab.kind === 'text' && !opts.preserveFocus) editor.focus();
  return tab;
}

// abas que não são arquivos (ex.: Configurações)
export function openSpecial(kind, name) {
  let tab = tabs.find(t => t.kind === kind);
  if (!tab) {
    tab = { kind, name, path: null, dirty: false };
    tabs.splice(active ? tabs.indexOf(active) + 1 : tabs.length, 0, tab);
  }
  activate(tab);
  return tab;
}

const SPECIAL_ICONS = { settings: 'settings-gear', shortcuts: 'keyboard' };

export function newUntitled(language = 'plaintext', content = '') {
  untitledCount++;
  const model = monaco.editor.createModel(content, language, monaco.Uri.parse(`untitled:Sem título-${untitledCount}`));
  const tab = { kind: 'text', path: null, name: `Sem título-${untitledCount}`, model, savedVersion: model.getAlternativeVersionId(), dirty: false };
  tabs.splice(active ? tabs.indexOf(active) + 1 : tabs.length, 0, tab);
  activate(tab);
  editor.focus();
  return tab;
}

export async function activate(tab) {
  if (active?.kind === 'text' && active !== tab) active.viewState = editor.saveViewState();
  active = tab;
  if (tab?.kind === 'text') {
    editor.setModel(tab.model);
    if (tab.viewState) editor.restoreViewState(tab.viewState);
  } else {
    editor.setModel(null);
    if (tab?.kind === 'media') await renderMedia(tab);
  }
  renderTabs();
  showArea();
  scrollTabIntoView();
}

async function renderMedia(tab) {
  const box = $('#media-preview');
  box.replaceChildren();
  let url;
  try { url = await api.invoke('fs:readDataUrl', tab.path); } catch (e) { return errorToast(e); }
  const meta = h('div', { class: 'meta' }, tab.name);
  if (MEDIA_EXT.test(tab.path)) {
    const isAudio = /\.(mp3|wav|ogg)$/i.test(tab.path);
    box.append(h(isAudio ? 'audio' : 'video', { src: url, controls: true }), meta);
  } else {
    const img = h('img', { src: url });
    img.onload = () => { meta.textContent = `${tab.name} — ${img.naturalWidth} × ${img.naturalHeight}`; };
    box.append(img, meta);
    if (/\.svg$/i.test(tab.path)) box.append(h('button', { class: 'btn ghost', onclick: () => { closeTab(tab); openFile(tab.path, { asText: true }); } }, 'Editar código SVG'));
  }
}

function scrollTabIntoView() {
  const el = $('#tabs .tab.active');
  el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

let dragTab = null;
export function renderTabs() {
  const bar = $('#tabs');
  const names = new Map();
  for (const t of tabs) names.set(t.name, (names.get(t.name) || 0) + 1);
  bar.replaceChildren(...tabs.map(t => {
    const hint = names.get(t.name) > 1 && t.path ? relative(state.root, dirname(t.path)) : null;
    const el = h('div', {
      class: `tab${t === active ? ' active' : ''}${t.dirty ? ' dirty' : ''}${t.deleted ? ' deleted' : ''}`,
      title: t.path || t.name, draggable: 'true',
      onmousedown: e => { if (e.button === 1) { e.preventDefault(); closeTab(t); } },
      onclick: () => activate(t),
      oncontextmenu: e => { e.preventDefault(); tabMenu(t); },
      ondragstart: () => { dragTab = t; },
      ondragover: e => { if (dragTab) { e.preventDefault(); el.classList.add('drag-over'); } },
      ondragleave: () => el.classList.remove('drag-over'),
      ondrop: e => {
        e.preventDefault(); el.classList.remove('drag-over');
        if (!dragTab || dragTab === t) return;
        tabs.splice(tabs.indexOf(dragTab), 1);
        tabs.splice(tabs.indexOf(t), 0, dragTab);
        dragTab = null; renderTabs();
      }
    },
      SPECIAL_ICONS[t.kind] ? h('span', { class: 'ficon' }, h('i', { class: `codicon codicon-${SPECIAL_ICONS[t.kind]}` })) : fileIcon(t.name),
      h('span', { class: 'label' }, t.name),
      hint ? h('span', { class: 'hint' }, hint) : null,
      h('button', { class: 'close', title: 'Fechar (⌘W)', onclick: e => { e.stopPropagation(); closeTab(t); } }, h('i', { class: 'codicon codicon-close' }))
    );
    return el;
  }));
  updateTitle();
}

async function tabMenu(t) {
  const id = await contextMenu([
    { id: 'close', label: 'Fechar' }, { id: 'others', label: 'Fechar outras' }, { id: 'right', label: 'Fechar à direita' },
    { id: 'saved', label: 'Fechar salvas' }, { id: 'all', label: 'Fechar todas' }, { type: 'separator' },
    { id: 'copy', label: 'Copiar caminho', enabled: !!t.path }, { id: 'copyRel', label: 'Copiar caminho relativo', enabled: !!t.path },
    { id: 'reveal', label: 'Mostrar no Finder', enabled: !!t.path }, { id: 'browser', label: 'Abrir no navegador padrão', enabled: !!t.path && /\.html?$/i.test(t.path) }
  ]);
  if (id === 'close') closeTab(t);
  else if (id === 'others') closeMany(tabs.filter(x => x !== t));
  else if (id === 'right') closeMany(tabs.slice(tabs.indexOf(t) + 1));
  else if (id === 'saved') closeMany(tabs.filter(x => !x.dirty));
  else if (id === 'all') closeMany([...tabs]);
  else if (id === 'copy') navigator.clipboard.writeText(t.path);
  else if (id === 'copyRel') navigator.clipboard.writeText(relative(state.root, t.path));
  else if (id === 'reveal') api.invoke('shell:reveal', t.path);
  else if (id === 'browser') api.invoke('shell:openPath', t.path);
}

export async function closeMany(list) {
  for (const t of list) if (!(await closeTab(t))) return false;
  return true;
}

export async function closeTab(tab = active) {
  if (!tab) return true;
  if (tab.dirty) {
    const r = await api.invoke('dialog:confirm', {
      message: `Deseja salvar as alterações em ${tab.name}?`, detail: 'Suas alterações serão perdidas se você não salvá-las.',
      buttons: ['Salvar', 'Não salvar', 'Cancelar']
    });
    if (r === 2) return false;
    if (r === 0 && !(await save(tab))) return false;
  }
  const i = tabs.indexOf(tab);
  if (i < 0) return true;
  tabs.splice(i, 1);
  if (tab.kind === 'text') tab.model.dispose();
  if (active === tab) {
    active = null;
    const next = tabs[Math.min(i, tabs.length - 1)];
    if (next) await activate(next); else { editor.setModel(null); renderTabs(); showArea(); }
  } else renderTabs();
  api.send('app:dirty', tabs.filter(t => t.dirty).length);
  return true;
}

export async function save(tab = active, { as = false } = {}) {
  if (!tab || tab.kind !== 'text') return false;
  let path = tab.path;
  if (!path || as) {
    path = await api.invoke('dialog:saveAs', tab.path || (state.root ? `${state.root}/${tab.name}` : tab.name));
    if (!path) return false;
  }
  if (state.settings['editor.formatOnSave'] && tab === active) {
    try { await editor.getAction('editor.action.formatDocument')?.run(); } catch {}
  }
  try {
    await api.invoke('fs:writeFile', path, tab.model.getValue());
  } catch (e) { errorToast(e); return false; }
  if (path !== tab.path) {
    // o URI do modelo é imutável: recria com o novo caminho (define a linguagem pela extensão)
    const old = tab.model;
    const existing = monaco.editor.getModel(monaco.Uri.file(path));
    if (existing && existing !== old) existing.dispose();
    tab.model = monaco.editor.createModel(old.getValue(), undefined, monaco.Uri.file(path));
    tab.path = path;
    tab.name = basename(path);
    if (tab === active) editor.setModel(tab.model);
    old.dispose();
  }
  tab.savedVersion = tab.model.getAlternativeVersionId();
  tab.deleted = false;
  tab.dirty = true; // força atualização
  updateDirty(tab);
  renderTabs();
  emit('saved', tab);
  return true;
}

export async function saveAll() {
  for (const t of tabs) if (t.dirty) await save(t);
}

// arquivos alterados no disco por outro programa
export async function onFsChanged(paths) {
  const set = new Set(paths);
  for (const t of tabs) {
    if (!t.path || !set.has(t.path)) continue;
    const exists = await api.invoke('fs:exists', t.path);
    if (!exists) { t.deleted = true; continue; }
    t.deleted = false;
    if (t.kind === 'media') { if (t === active) renderMedia(t); continue; }
    if (t.dirty) continue;
    try {
      const data = await api.invoke('fs:readFile', t.path);
      if (data.content != null && data.content !== t.model.getValue()) {
        t.model.pushEditOperations([], [{ range: t.model.getFullModelRange(), text: data.content }], () => null);
        t.savedVersion = t.model.getAlternativeVersionId();
      }
    } catch {}
  }
  renderTabs();
}

// arquivos renomeados/movidos no explorador
export function onRenamed(from, to) {
  for (const t of tabs) {
    if (!t.path || !(t.path === from || t.path.startsWith(from + '/'))) continue;
    const newPath = to + t.path.slice(from.length);
    if (t.kind === 'text') {
      const old = t.model;
      t.model = monaco.editor.createModel(old.getValue(), undefined, monaco.Uri.file(newPath));
      t.savedVersion = t.dirty ? -1 : t.model.getAlternativeVersionId();
      if (t === active) editor.setModel(t.model);
      old.dispose();
    }
    t.path = newPath;
    t.name = basename(newPath);
  }
  renderTabs();
}

export function cycleTab(dir) {
  if (!tabs.length) return;
  const i = (tabs.indexOf(active) + dir + tabs.length) % tabs.length;
  activate(tabs[i]);
}

export function setLanguage(lang) {
  if (active?.kind === 'text') { monaco.editor.setModelLanguage(active.model, lang); emit('cursor'); }
}

export const languages = () => monaco.languages.getLanguages();
export const markers = () => monaco.editor.getModelMarkers({});
export { monaco };
