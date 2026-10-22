// Erros na própria linha (estilo "Error Lens"): mensagem no fim da linha + fundo colorido, sem precisar passar o mouse
import * as monaco from './gen/monaco-lite.js';
import { state, on } from './state.js';
import { editor } from './editor.js';
import { translate } from './translate.js';

const S = monaco.MarkerSeverity;
const CLASS = { [S.Error]: 'err', [S.Warning]: 'warn', [S.Info]: 'info', [S.Hint]: 'info' };
let collection = null;
let timer = null;
let styleEl = null;

// o texto vai num ::after com CSS gerado (o mesmo truque da extensão Error Lens do VS Code)
const cssString = t => '"' + t.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\n\r]/g, ' ') + '"';

function mode() { return state.settings['editor.errorLens'] || 'all'; }

function update() {
  if (!editor) return;
  collection ??= editor.createDecorationsCollection();
  const model = editor.getModel();
  const m = mode();
  if (!model || m === 'off') { collection.clear(); return; }
  const minSeverity = m === 'errors' ? S.Error : S.Warning;
  const byLine = new Map();
  for (const mk of monaco.editor.getModelMarkers({ resource: model.uri })) {
    if (mk.severity < minSeverity) continue;
    const line = Math.min(mk.startLineNumber, model.getLineCount());
    const list = byLine.get(line) || [];
    list.push(mk);
    byLine.set(line, list);
  }
  const decorations = [];
  const rules = [];
  for (const [line, list] of byLine) {
    list.sort((a, b) => b.severity - a.severity || a.startColumn - b.startColumn);
    const top = list[0];
    const cls = CLASS[top.severity] || 'info';
    const lang = model.getLanguageId();
    let msg = String(top.message).split('\n')[0].trim();
    // marcadores do próprio Monaco (JS/TS, JSON, CSS) não passam pelo LSP: traduz aqui
    if (!top.owner?.startsWith('lsp:') && top.owner !== 'lint:python') msg = translate(msg, lang)?.split('\n')[0] || msg;
    if (msg.length > 90) msg = msg.slice(0, 88) + "…"; // a mensagem completa aparece ao passar o mouse
    const extra = list.length > 1 ? `  (+${list.length - 1})` : '';
    const end = model.getLineMaxColumn(line);
    const id = `lens-t${rules.length}`;
    rules.push(`.monaco-editor .${id}::after { content: ${cssString(msg + extra)}; }`);
    decorations.push(
      { range: new monaco.Range(line, 1, line, 1), options: { isWholeLine: true, className: `lens-line lens-line-${cls}` } },
      { range: new monaco.Range(line, end, line, end), options: { afterContentClassName: `lens-msg lens-msg-${cls} ${id}`, stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges } }
    );
  }
  styleEl ??= document.head.appendChild(document.createElement('style'));
  styleEl.textContent = rules.join('\n');
  collection.set(decorations);
}

// marcadores mudam muito enquanto se digita: agrupa as atualizações
function schedule() { clearTimeout(timer); timer = setTimeout(update, 60); }

export function initErrorLens() {
  monaco.editor.onDidChangeMarkers(uris => {
    const model = editor?.getModel();
    if (model && uris.some(u => u.toString() === model.uri.toString())) schedule();
  });
  editor.onDidChangeModel(schedule);
  on('settings', schedule);
  on('translations', schedule);
  update();
}
