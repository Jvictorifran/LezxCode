// Extensões de linguagem: aba lateral, snippets/palavras-chave, verificação de sintaxe e início dos servidores LSP
import * as monaco from './gen/monaco-lite.js';
import { api, $, h, toast, errorToast, debounce, IS_WIN } from './ui.js';
import { state, on, emit } from './state.js';
import { startClient, stopClient, hasLanguageServer, runningClients, initLsp, notifySaved } from './lsp-client.js';
import { markerMessage } from './translate.js';
import { uriToPath } from './editor.js';

let list = [];
let query = '';
const progress = new Map();  // id -> texto
const lspStatus = new Map(); // id -> { status, message }
const packSubs = new Map();  // id -> disposables (snippets/palavras-chave)
const lintSubs = new Map();  // uri -> disposable

const installed = () => list.filter(e => e.installed);

// ---------- snippets, funções e palavras-chave ----------
function functionItems(ext) {
  return (ext.functions || []).map(f => {
    const o = typeof f === 'string' ? { label: f.split('(')[0], insert: f } : f;
    return { label: o.label, insert: o.insert || o.label, detail: o.detail, doc: o.doc };
  });
}

function registerPack(ext) {
  if (packSubs.has(ext.id)) return;
  const K = monaco.languages.CompletionItemKind;
  const snippetRule = monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet;
  const snippets = Object.entries(ext.snippets || {}).flatMap(([name, s]) => [].concat(s.prefix || name).map(prefix => ({
    prefix, body: [].concat(s.body).join('\n'), description: s.description || name
  })));
  const functions = functionItems(ext);
  const keywords = ext.keywords || [];
  const subs = ext.languages.map(lang => monaco.languages.registerCompletionItemProvider(lang, {
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
      // com servidor de linguagem ativo, ele já sugere funções e palavras-chave: aqui ficam só os snippets
      const lsp = hasLanguageServer(lang);
      const out = snippets.map(s => ({
        label: s.prefix, kind: K.Snippet, detail: s.description, insertText: s.body, insertTextRules: snippetRule, range,
        documentation: { value: '```' + lang + '\n' + s.body.replace(/\$\{\d+:?([^}]*)\}/g, '$1').replace(/\$\d/g, '') + '\n```' }, sortText: '0' + s.prefix
      }));
      if (!lsp) {
        for (const f of functions) out.push({ label: f.label, kind: K.Function, detail: f.detail || ext.name, documentation: f.doc, insertText: f.insert, insertTextRules: snippetRule, range });
        for (const k of keywords) out.push({ label: k, kind: K.Keyword, insertText: k, range, sortText: '2' + k });
      }
      return { suggestions: out };
    }
  }));
  packSubs.set(ext.id, subs);
}

function unregisterPack(id) {
  for (const s of packSubs.get(id) || []) s.dispose();
  packSubs.delete(id);
}

// ---------- verificação de sintaxe Python (sem servidor) ----------
function attachLint(model) {
  const uri = model.uri.toString();
  if (lintSubs.has(uri) || model.getLanguageId() !== 'python') return;
  const run = debounce(async () => {
    if (model.isDisposed()) return;
    if (hasLanguageServer('python')) { monaco.editor.setModelMarkers(model, 'lint:python', []); return; }
    const errs = await api.invoke('lint:python', model.uri.scheme === 'file' ? uriToPath(model.uri) : null, model.getValue()).catch(() => []);
    if (model.isDisposed()) return;
    monaco.editor.setModelMarkers(model, 'lint:python', errs.map(e => ({
      startLineNumber: e.line, startColumn: e.col, endLineNumber: e.endLine || e.line, endColumn: Math.max(e.endCol || e.col + 1, e.col + 1),
      message: markerMessage(e.message, 'python'), severity: monaco.MarkerSeverity.Error, source: 'python'
    })));
  }, 500);
  const sub = model.onDidChangeContent(run);
  model.onWillDispose(() => { sub.dispose(); lintSubs.delete(uri); });
  sub.run = run;
  lintSubs.set(uri, sub);
  run();
}

function detachLints() {
  for (const sub of lintSubs.values()) sub.dispose();
  lintSubs.clear();
  for (const m of monaco.editor.getModels()) monaco.editor.setModelMarkers(m, 'lint:python', []);
}

// ---------- servidores ----------
// inicia o servidor só quando um arquivo da linguagem é aberto
function ensureServers() {
  const langs = new Set(monaco.editor.getModels().filter(m => m.uri.scheme === 'file').map(m => m.getLanguageId()));
  const running = new Set(runningClients());
  for (const ext of installed()) {
    if (!ext.serverConfig || ext.serverState !== 'ready') continue;
    if (running.has(ext.id) || lspStatus.get(ext.id)?.status === 'starting') continue;
    if (lspStatus.get(ext.id)?.status === 'error') continue;
    if (!ext.languages.some(l => langs.has(l))) continue;
    lspStatus.set(ext.id, { status: 'starting' });
    render();
    startClient(ext);
  }
}

function applyInstalled() {
  const ids = new Set(installed().map(e => e.id));
  for (const id of [...packSubs.keys()]) if (!ids.has(id)) unregisterPack(id);
  for (const id of runningClients()) if (!ids.has(id)) stopClient(id);
  for (const ext of installed()) registerPack(ext);
  const pyLint = installed().some(e => e.linter === 'python');
  if (pyLint) for (const m of monaco.editor.getModels()) attachLint(m);
  else detachLints();
  ensureServers();
}

async function refresh() {
  list = (await api.invoke('ext:list')).map(e => ({ ...e, serverConfig: e.server || null }));
  render();
  applyInstalled();
}

// ---------- interface ----------
function features(ext) {
  const f = [];
  if (ext.serverConfig) f.push('Erros', 'IntelliSense');
  else if (ext.linter) f.push('Erros de sintaxe');
  const n = Object.keys(ext.snippets || {}).length;
  if (n) f.push(`${n} snippets`);
  if ((ext.functions || []).length) f.push('Funções');
  if ((ext.keywords || []).length) f.push('Palavras-chave');
  return f;
}

function statusLine(ext) {
  const p = progress.get(ext.id);
  if (p) return h('div', { class: 'ext-status busy' }, h('i', { class: 'codicon codicon-loading codicon-modifier-spin' }), p);
  if (!ext.serverConfig) return null;
  const cmdName = ext.serverConfig.command;
  const ls = lspStatus.get(ext.id);
  if (ext.installed && ls?.status === 'running') return h('div', { class: 'ext-status ok' }, h('i', { class: 'codicon codicon-pass-filled' }), `${cmdName} ativo`);
  if (ext.installed && ls?.status === 'error') return h('div', { class: 'ext-status err', title: ls.message }, h('i', { class: 'codicon codicon-error' }), `Erro ao iniciar ${cmdName}`,
    h('a', { href: '#', onclick: e => { e.preventDefault(); lspStatus.delete(ext.id); ensureServers(); } }, 'tentar de novo'));
  if (ext.serverState === 'ready') return h('div', { class: 'ext-status ok' }, h('i', { class: 'codicon codicon-check' }), h('span', {}, ext.installed ? `${cmdName} pronto (inicia ao abrir um arquivo)` : `${cmdName} encontrado no seu Mac`));
  if (ext.serverState === 'npm') return h('div', { class: 'ext-status' }, h('i', { class: 'codicon codicon-cloud-download' }), `Baixa ${[].concat(ext.serverConfig.npm).join(', ')} via npm`);
  const hint = (IS_WIN && ext.serverConfig.installHintWin) || ext.serverConfig.installHint;
  return h('div', { class: 'ext-status warn' }, h('i', { class: 'codicon codicon-warning' }), `Precisa de ${cmdName}`,
    hint ? h('a', { href: '#', title: hint, onclick: e => { e.preventDefault(); emit('command', 'terminal.run', hint); } }, 'instalar no terminal') : null);
}

function card(ext) {
  const icon = ext.icon || { text: ext.name[0] };
  const busy = progress.has(ext.id);
  return h('div', { class: `ext-card${ext.installed ? ' installed' : ''}` },
    h('div', { class: 'ext-icon', style: { color: icon.color || 'var(--accent)' } }, icon.text || '✱'),
    h('div', { class: 'ext-main' },
      h('div', { class: 'ext-title' }, h('b', {}, ext.name), h('span', { class: 'ext-ver' }, `${ext.version || ''}${ext.source === 'user' ? ' · minha' : ''}`)),
      h('div', { class: 'ext-desc', title: ext.description }, ext.description || ''),
      h('div', { class: 'ext-feats' }, ...features(ext).map(f => h('span', {}, f))),
      statusLine(ext),
      h('div', { class: 'ext-actions' },
        ext.installed
          ? h('button', { class: 'btn ghost small', disabled: busy, onclick: () => uninstall(ext) }, 'Desinstalar')
          : h('button', { class: 'btn small', disabled: busy, onclick: () => install(ext) }, busy ? 'Instalando…' : 'Instalar'),
        ext.source === 'user' ? h('button', { class: 'btn ghost small', title: 'Editar JSON', onclick: () => emit('command', 'file.openPath', ext.file) }, h('i', { class: 'codicon codicon-edit' })) : null)));
}

export function render() {
  const box = $('#ext-list');
  if (!box) return;
  const q = query.toLowerCase();
  const visible = list.filter(e => !q || [e.name, e.description, ...e.languages].some(t => t?.toLowerCase().includes(q)));
  const inst = visible.filter(e => e.installed), avail = visible.filter(e => !e.installed);
  box.replaceChildren(
    inst.length ? h('div', { class: 'ext-group' }, `INSTALADAS (${inst.length})`) : null, ...inst.map(card),
    avail.length ? h('div', { class: 'ext-group' }, `DISPONÍVEIS (${avail.length})`) : null, ...avail.map(card),
    !visible.length ? h('p', { class: 'empty-state' }, 'Nenhuma extensão encontrada.') : null);
}

async function install(ext) {
  progress.set(ext.id, 'Instalando…');
  render();
  try {
    await api.invoke('ext:install', ext.id);
    lspStatus.delete(ext.id);
    toast(`${ext.name} instalada.${ext.serverConfig ? ' Abra um arquivo dessa linguagem para ativar o IntelliSense.' : ''}`);
  } catch (e) { errorToast(e); }
  progress.delete(ext.id);
  await refresh();
}

async function uninstall(ext) {
  stopClient(ext.id);
  for (const m of monaco.editor.getModels()) monaco.editor.setModelMarkers(m, 'lsp:' + ext.id, []);
  lspStatus.delete(ext.id);
  try { await api.invoke('ext:uninstall', ext.id); } catch (e) { errorToast(e); }
  await refresh();
}

export function initExtensions() {
  initLsp();
  $('#ext-search').addEventListener('input', e => { query = e.target.value.trim(); render(); });
  $('#view-extensions .view-actions').addEventListener('click', e => {
    const a = e.target.closest('button')?.dataset.action;
    if (a === 'folder') api.invoke('ext:openFolder');
    else if (a === 'refresh') refresh();
    else if (a === 'example') emit('command', 'ext.editExample');
  });
  api.on('ext:progress', (id, msg) => { if (progress.has(id)) { progress.set(id, msg); render(); } });
  api.on('ext:changed', () => refresh());
  on('lsp', (id, status, message) => { lspStatus.set(id, { status, message }); render(); });
  on('activeTab', () => ensureServers());
  on('translations', () => { for (const sub of lintSubs.values()) sub.run?.(); });
  on('saved', tab => { if (tab.model) notifySaved(tab.model); });
  on('root', () => {
    // novo projeto: reinicia os servidores com a nova raiz
    for (const id of runningClients()) stopClient(id);
    lspStatus.clear();
    setTimeout(ensureServers, 300);
  });
  monaco.editor.onDidCreateModel(model => {
    if (installed().some(e => e.linter === 'python')) attachLint(model);
    setTimeout(ensureServers, 50);
  });
  refresh();
}
