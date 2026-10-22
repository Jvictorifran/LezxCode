// Cliente LSP no renderer: conecta servidores de linguagem (clangd, pyright, intelephense...) ao Monaco
import * as monaco from './gen/monaco-lite.js';
import { api, toast } from './ui.js';
import { state, emit, on } from './state.js';
import { markerMessage } from './translate.js';

const clients = new Map();   // id da extensão -> LspClient
const byLanguage = new Map(); // id da linguagem (Monaco) -> LspClient
const providers = new Map(); // linguagem -> disposables

const K = monaco.languages.CompletionItemKind;
// LSP CompletionItemKind (1..25) -> Monaco
const KIND = [null, K.Text, K.Method, K.Function, K.Constructor, K.Field, K.Variable, K.Class, K.Interface, K.Module, K.Property, K.Unit, K.Value,
  K.Enum, K.Keyword, K.Snippet, K.Color, K.File, K.Reference, K.Folder, K.EnumMember, K.Constant, K.Struct, K.Event, K.Operator, K.TypeParameter];
const SEVERITY = [null, monaco.MarkerSeverity.Error, monaco.MarkerSeverity.Warning, monaco.MarkerSeverity.Info, monaco.MarkerSeverity.Hint];

const toPos = p => ({ line: p.lineNumber - 1, character: p.column - 1 });
const toRange = r => new monaco.Range(r.start.line + 1, r.start.character + 1, r.end.line + 1, r.end.character + 1);
const fromRange = r => ({ start: { line: r.startLineNumber - 1, character: r.startColumn - 1 }, end: { line: r.endLineNumber - 1, character: r.endColumn - 1 } });
const md = c => {
  if (!c) return undefined;
  if (typeof c === 'string') return { value: c };
  if (Array.isArray(c)) { const v = c.map(md).filter(Boolean).map(x => x.value).join('\n\n'); return v ? { value: v } : undefined; }
  if (c.kind) return { value: c.kind === 'markdown' ? c.value : '```\n' + c.value + '\n```' };
  if (c.language) return { value: '```' + c.language + '\n' + c.value + '\n```' };
  return { value: String(c.value ?? '') };
};
const textEdit = e => ({ range: toRange(e.range), text: e.newText });

class LspClient {
  constructor(ext, root) {
    this.ext = ext;
    this.id = ext.id;
    this.root = root;
    this.seq = 0;
    this.pending = new Map();
    this.docs = new Map(); // uri -> { model, version, timer, subs }
    this.rawDiagnostics = new Map(); // uri -> diagnósticos originais do servidor
    this.capabilities = {};
    this.ready = null;
    this.alive = false;
    this.restarts = 0;
  }

  languageId(model) { return this.ext.server?.languageIds?.[model.getLanguageId()] || model.getLanguageId(); }

  async start() {
    const r = await api.invoke('lsp:start', this.id, this.root);
    if (!r.ok) throw new Error(r.error);
    this.alive = true;
    const rootUri = this.root ? monaco.Uri.file(this.root).toString() : null;
    const init = await this.request('initialize', {
      processId: null,
      clientInfo: { name: 'Lezx Code', version: state.info.version },
      rootUri, rootPath: this.root,
      workspaceFolders: this.root ? [{ uri: rootUri, name: this.root.split('/').pop() }] : null,
      initializationOptions: this.ext.server.initializationOptions,
      capabilities: {
        textDocument: {
          synchronization: { didSave: true, willSave: false, dynamicRegistration: false },
          completion: { contextSupport: true, completionItem: { snippetSupport: true, documentationFormat: ['markdown', 'plaintext'], labelDetailsSupport: true, insertReplaceSupport: true, resolveSupport: { properties: ['documentation', 'detail', 'additionalTextEdits'] } } },
          hover: { contentFormat: ['markdown', 'plaintext'] },
          signatureHelp: { signatureInformation: { documentationFormat: ['markdown', 'plaintext'], parameterInformation: { labelOffsetSupport: true }, activeParameterSupport: true } },
          definition: { linkSupport: true }, declaration: { linkSupport: true }, references: {},
          formatting: {}, rename: { prepareSupport: false },
          codeAction: { codeActionLiteralSupport: { codeActionKind: { valueSet: ['', 'quickfix', 'refactor', 'refactor.extract', 'refactor.inline', 'refactor.rewrite', 'source', 'source.organizeImports'] } }, isPreferredSupport: true },
          publishDiagnostics: { relatedInformation: true, versionSupport: false }
        },
        workspace: { configuration: true, workspaceFolders: true, applyEdit: true, didChangeConfiguration: { dynamicRegistration: false } },
        window: { workDoneProgress: false, showMessage: {} },
        general: { positionEncodings: ['utf-16'] }
      }
    });
    this.capabilities = init?.capabilities || {};
    this.notify('initialized', {});
    for (const model of monaco.editor.getModels()) this.maybeOpen(model);
  }

  request(method, params) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      api.send('lsp:send', this.id, { jsonrpc: '2.0', id, method, params });
    });
  }
  notify(method, params) { api.send('lsp:send', this.id, { jsonrpc: '2.0', method, params }); }
  respond(id, result) { api.send('lsp:send', this.id, { jsonrpc: '2.0', id, result }); }

  handle(msg) {
    if (msg.id != null && !msg.method) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message)); else p.resolve(msg.result);
      return;
    }
    if (msg.method && msg.id != null) return this.handleRequest(msg);
    switch (msg.method) {
      case 'textDocument/publishDiagnostics': return this.diagnostics(msg.params);
      case 'window/showMessage': if (msg.params.type === 1) toast(`${this.ext.name}: ${msg.params.message}`, 'error'); return;
    }
  }

  handleRequest(msg) {
    switch (msg.method) {
      case 'workspace/configuration': return this.respond(msg.id, (msg.params.items || []).map(() => null));
      case 'workspace/workspaceFolders': return this.respond(msg.id, this.root ? [{ uri: monaco.Uri.file(this.root).toString(), name: this.root.split('/').pop() }] : null);
      case 'workspace/applyEdit': applyWorkspaceEdit(msg.params.edit); return this.respond(msg.id, { applied: true });
      default: return this.respond(msg.id, null);
    }
  }

  diagnostics({ uri, diagnostics }) {
    this.rawDiagnostics.set(uri, diagnostics);
    const model = monaco.editor.getModel(monaco.Uri.parse(uri));
    if (!model) return;
    const lang = model.getLanguageId();
    monaco.editor.setModelMarkers(model, 'lsp:' + this.id, diagnostics.map(d => ({
      startLineNumber: d.range.start.line + 1, startColumn: d.range.start.character + 1,
      endLineNumber: d.range.end.line + 1, endColumn: d.range.end.character + 1,
      severity: SEVERITY[d.severity || 1], message: markerMessage(d.message, lang), source: d.source || this.ext.name,
      code: d.code != null ? String(d.code) : undefined,
      tags: (d.tags || []).map(t => (t === 1 ? monaco.MarkerTag.Unnecessary : monaco.MarkerTag.Deprecated))
    })));
  }

  handles(model) { return model.uri.scheme === 'file' && this.ext.languages.includes(model.getLanguageId()); }

  maybeOpen(model) {
    if (!this.alive || !this.handles(model)) return;
    const uri = model.uri.toString();
    if (this.docs.has(uri)) return;
    const doc = { model, version: 1, timer: null };
    doc.subs = [
      model.onDidChangeContent(() => { clearTimeout(doc.timer); doc.timer = setTimeout(() => this.flush(doc), 120); }),
      model.onWillDispose(() => this.close(uri))
    ];
    this.docs.set(uri, doc);
    this.notify('textDocument/didOpen', { textDocument: { uri, languageId: this.languageId(model), version: doc.version, text: model.getValue() } });
  }

  flush(doc) {
    if (!doc.timer && doc.sent === doc.model.getAlternativeVersionId()) return;
    clearTimeout(doc.timer); doc.timer = null;
    doc.sent = doc.model.getAlternativeVersionId();
    doc.version++;
    this.notify('textDocument/didChange', { textDocument: { uri: doc.model.uri.toString(), version: doc.version }, contentChanges: [{ text: doc.model.getValue() }] });
  }

  sync(model) { const d = this.docs.get(model.uri.toString()); if (d?.timer) this.flush(d); }

  close(uri) {
    const doc = this.docs.get(uri);
    if (!doc) return;
    clearTimeout(doc.timer);
    doc.subs.forEach(s => s.dispose());
    this.docs.delete(uri);
    if (this.alive) this.notify('textDocument/didClose', { textDocument: { uri } });
    if (!doc.model.isDisposed()) monaco.editor.setModelMarkers(doc.model, 'lsp:' + this.id, []);
  }

  saved(model) { if (this.docs.has(model.uri.toString())) this.notify('textDocument/didSave', { textDocument: { uri: model.uri.toString() } }); }

  stop() {
    for (const uri of [...this.docs.keys()]) this.close(uri);
    if (this.alive) { this.request('shutdown').catch(() => {}).finally(() => { this.notify('exit'); setTimeout(() => api.send('lsp:stop', this.id), 300); }); }
    this.alive = false;
    for (const p of this.pending.values()) p.reject(new Error('servidor parado'));
    this.pending.clear();
  }

  async call(model, method, params) {
    if (!this.alive) return null;
    this.sync(model);
    try { return await this.request(method, { textDocument: { uri: model.uri.toString() }, ...params }); }
    catch { return null; }
  }
}

function applyWorkspaceEdit(edit) {
  const changes = { ...(edit.changes || {}) };
  for (const dc of edit.documentChanges || []) if (dc.textDocument) changes[dc.textDocument.uri] = dc.edits;
  for (const [uri, edits] of Object.entries(changes)) {
    const model = monaco.editor.getModel(monaco.Uri.parse(uri));
    if (model) model.pushEditOperations([], edits.map(textEdit), () => null);
  }
}

function toWorkspaceEdit(edit) {
  if (!edit) return null;
  const out = [];
  const changes = { ...(edit.changes || {}) };
  for (const dc of edit.documentChanges || []) if (dc.textDocument) changes[dc.textDocument.uri] = dc.edits;
  for (const [uri, edits] of Object.entries(changes)) {
    const resource = monaco.Uri.parse(uri);
    if (!monaco.editor.getModel(resource)) continue; // só arquivos abertos
    for (const e of edits) out.push({ resource, textEdit: textEdit(e), versionId: undefined });
  }
  return { edits: out };
}

const clientFor = model => { const c = byLanguage.get(model.getLanguageId()); return c?.alive && c.handles(model) ? c : null; };
export const hasLanguageServer = lang => !!byLanguage.get(lang)?.alive;

function registerProviders(lang) {
  if (providers.has(lang)) return;
  const L = monaco.languages;
  const subs = [
    L.registerCompletionItemProvider(lang, {
      triggerCharacters: ['.', '>', ':', '$', '"', '<', '/', '\\', '@', "'", '-'],
      async provideCompletionItems(model, position, context) {
        const c = clientFor(model);
        if (!c) return { suggestions: [] };
        const trig = context.triggerCharacter;
        // só dispara em caracteres que o servidor declarou (">" em "->", ":" em "::" etc.)
        const allowed = c.capabilities.completionProvider?.triggerCharacters || [];
        if (context.triggerKind === L.CompletionTriggerKind.TriggerCharacter && trig && !allowed.includes(trig)) return { suggestions: [] };
        const res = await c.call(model, 'textDocument/completion', {
          position: toPos(position),
          context: { triggerKind: context.triggerKind + 1, triggerCharacter: trig }
        });
        if (!res) return { suggestions: [] };
        const items = Array.isArray(res) ? res : res.items || [];
        const word = model.getWordUntilPosition(position);
        const defRange = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
        return {
          incomplete: !!res.isIncomplete,
          suggestions: items.map(it => {
            const te = it.textEdit;
            const label = String(it.label).replace(/^[\s•]+/, '');
            return {
              label: it.labelDetails ? { label, detail: it.labelDetails.detail, description: it.labelDetails.description } : label,
              kind: KIND[it.kind] ?? K.Text,
              detail: it.detail,
              documentation: md(it.documentation),
              insertText: te?.newText ?? it.insertText ?? label,
              insertTextRules: it.insertTextFormat === 2 ? L.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
              range: te ? (te.range ? toRange(te.range) : { insert: toRange(te.insert), replace: toRange(te.replace) }) : defRange,
              filterText: it.filterText, sortText: it.sortText, preselect: it.preselect,
              commitCharacters: it.commitCharacters,
              additionalTextEdits: it.additionalTextEdits?.map(textEdit),
              tags: it.deprecated || it.tags?.includes(1) ? [L.CompletionItemTag.Deprecated] : undefined,
              _lsp: it, _client: c
            };
          })
        };
      },
      async resolveCompletionItem(item) {
        const c = item._client;
        if (!c?.capabilities.completionProvider?.resolveProvider || item.documentation) return item;
        try {
          const r = await c.request('completionItem/resolve', item._lsp);
          if (r) {
            item.documentation = md(r.documentation) || item.documentation;
            item.detail = r.detail || item.detail;
            if (r.additionalTextEdits) item.additionalTextEdits = r.additionalTextEdits.map(textEdit);
          }
        } catch {}
        return item;
      }
    }),
    L.registerHoverProvider(lang, {
      async provideHover(model, position) {
        const c = clientFor(model);
        if (!c?.capabilities.hoverProvider) return null;
        const r = await c.call(model, 'textDocument/hover', { position: toPos(position) });
        if (!r?.contents) return null;
        const contents = Array.isArray(r.contents) ? r.contents.map(md) : [md(r.contents)];
        return { contents: contents.filter(x => x?.value), range: r.range ? toRange(r.range) : undefined };
      }
    }),
    L.registerSignatureHelpProvider(lang, {
      signatureHelpTriggerCharacters: ['(', ','], signatureHelpRetriggerCharacters: [')'],
      async provideSignatureHelp(model, position) {
        const c = clientFor(model);
        if (!c?.capabilities.signatureHelpProvider) return null;
        const r = await c.call(model, 'textDocument/signatureHelp', { position: toPos(position) });
        if (!r?.signatures?.length) return null;
        return {
          value: {
            signatures: r.signatures.map(s => ({ label: s.label, documentation: md(s.documentation), parameters: (s.parameters || []).map(p => ({ label: p.label, documentation: md(p.documentation) })), activeParameter: s.activeParameter })),
            activeSignature: r.activeSignature || 0, activeParameter: r.activeParameter || 0
          },
          dispose() {}
        };
      }
    }),
    L.registerDefinitionProvider(lang, {
      async provideDefinition(model, position) {
        const c = clientFor(model);
        if (!c?.capabilities.definitionProvider) return null;
        const r = await c.call(model, 'textDocument/definition', { position: toPos(position) });
        if (!r) return null;
        return (Array.isArray(r) ? r : [r]).map(l => ({ uri: monaco.Uri.parse(l.targetUri || l.uri), range: toRange(l.targetSelectionRange || l.range) }));
      }
    }),
    L.registerDocumentFormattingEditProvider(lang, {
      async provideDocumentFormattingEdits(model, options) {
        const c = clientFor(model);
        if (!c?.capabilities.documentFormattingProvider) return [];
        const r = await c.call(model, 'textDocument/formatting', { options: { tabSize: options.tabSize, insertSpaces: options.insertSpaces } });
        return (r || []).map(textEdit);
      }
    }),
    L.registerRenameProvider(lang, {
      async provideRenameEdits(model, position, newName) {
        const c = clientFor(model);
        if (!c?.capabilities.renameProvider) return null;
        return toWorkspaceEdit(await c.call(model, 'textDocument/rename', { position: toPos(position), newName }));
      }
    }),
    L.registerCodeActionProvider(lang, {
      async provideCodeActions(model, range, context) {
        const c = clientFor(model);
        if (!c?.capabilities.codeActionProvider) return { actions: [], dispose() {} };
        // envia os diagnósticos originais (sem tradução) que tocam o trecho
        const diagnostics = (c.rawDiagnostics.get(model.uri.toString()) || []).filter(d =>
          monaco.Range.areIntersectingOrTouching(toRange(d.range), range));
        const r = await c.call(model, 'textDocument/codeAction', { range: fromRange(range), context: { diagnostics } });
        const actions = (r || []).filter(a => a.edit).map(a => ({ title: a.title, kind: a.kind, isPreferred: a.isPreferred, edit: toWorkspaceEdit(a.edit), diagnostics: context.markers }));
        return { actions, dispose() {} };
      }
    })
  ];
  providers.set(lang, subs);
}

// ---------- ciclo de vida ----------
export async function startClient(ext) {
  stopClient(ext.id);
  const c = new LspClient(ext, state.root);
  clients.set(ext.id, c);
  for (const lang of ext.languages) { byLanguage.set(lang, c); registerProviders(lang); }
  try {
    await c.start();
    emit('lsp', ext.id, 'running');
  } catch (e) {
    c.alive = false;
    emit('lsp', ext.id, 'error', e.message);
  }
  return c;
}

export function stopClient(id) {
  const c = clients.get(id);
  if (!c) return;
  c.stop();
  clients.delete(id);
  for (const [lang, cl] of byLanguage) if (cl === c) byLanguage.delete(lang);
  emit('lsp', id, 'stopped');
}

export const runningClients = () => [...clients.values()].filter(c => c.alive).map(c => c.id);

export function initLsp() {
  api.on('lsp:message', (id, msg) => clients.get(id)?.handle(msg));
  api.on('lsp:exit', id => {
    const c = clients.get(id);
    if (!c || !c.alive) return;
    c.alive = false;
    // reinicia automaticamente se o servidor cair (até 3 vezes)
    if (c.restarts < 3) {
      const ext = c.ext;
      const restarts = c.restarts + 1;
      setTimeout(async () => { const n = await startClient(ext); n.restarts = restarts; }, 1000);
    } else emit('lsp', id, 'error', 'O servidor de linguagem parou');
  });
  monaco.editor.onDidCreateModel(model => {
    for (const c of clients.values()) c.maybeOpen(model);
    model.onDidChangeLanguage(() => {
      for (const c of clients.values()) { if (!c.handles(model)) c.close(model.uri.toString()); else c.maybeOpen(model); }
    });
  });
}

// reaplica a tradução quando as regras ou a configuração mudam
on('translations', () => {
  for (const c of clients.values()) for (const [uri, diagnostics] of c.rawDiagnostics) c.diagnostics({ uri, diagnostics });
});

export function notifySaved(model) { for (const c of clients.values()) c.saved(model); }
