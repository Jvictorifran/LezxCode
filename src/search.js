// Pesquisa nos arquivos do projeto
import { api, $, h, basename, dirname, relative, debounce, errorToast } from './ui.js';
import { state } from './state.js';
import { fileIcon } from './icons.js';
import { openFile } from './editor.js';

const opts = { caseSensitive: false, wholeWord: false, regex: false };
const collapsed = new Set();
let lastResults = null;
let runId = 0;

async function run() {
  const q = $('#search-input').value;
  const id = ++runId;
  if (!q || !state.root) { $('#search-results').replaceChildren(); $('#search-summary').textContent = ''; return; }
  $('#search-summary').textContent = 'Pesquisando…';
  try {
    const res = await api.invoke('search:text', state.root, q, opts);
    if (id !== runId) return;
    lastResults = res;
    render();
  } catch (e) { if (id === runId) { $('#search-summary').textContent = ''; errorToast(e); } }
}

function render() {
  const { results, total } = lastResults;
  $('#search-summary').textContent = total ? `${total}${total > 5000 ? '+' : ''} resultado(s) em ${results.length} arquivo(s)` : 'Nenhum resultado encontrado.';
  const nodes = [];
  for (const r of results) {
    const rel = relative(state.root, r.file);
    const isCollapsed = collapsed.has(r.file);
    nodes.push(h('div', { class: 'sr-file', title: rel, onclick: () => { isCollapsed ? collapsed.delete(r.file) : collapsed.add(r.file); render(); } },
      h('i', { class: `codicon codicon-chevron-${isCollapsed ? 'right' : 'down'}` }), fileIcon(basename(r.file)),
      h('span', {}, basename(r.file)), h('span', { class: 'dir' }, dirname(rel) === rel ? '' : dirname(rel).replace(/^\.$/, '')),
      h('span', { class: 'count' }, String(r.matches.length))));
    if (isCollapsed) continue;
    for (const m of r.matches) {
      const start = Math.max(0, m.col - 1 - 30);
      const pre = (start > 0 ? '…' : '') + m.text.slice(start, m.col - 1).trimStart();
      nodes.push(h('div', { class: 'sr-line', title: m.text.trim(), onclick: () => openFile(r.file, { line: m.line, col: m.col, len: m.len }) },
        pre, h('mark', {}, m.text.substr(m.col - 1, m.len)), m.text.slice(m.col - 1 + m.len, m.col + 150)));
    }
  }
  $('#search-results').replaceChildren(...nodes);
}

export function focusSearch(text) {
  const inp = $('#search-input');
  if (text) { inp.value = text; run(); }
  inp.focus();
  inp.select();
}

export function initSearch() {
  const debounced = debounce(run, 300);
  $('#search-input').addEventListener('input', debounced);
  $('#search-input').addEventListener('keydown', e => { if (e.key === 'Enter') run(); });
  for (const [id, key] of [['search-case', 'caseSensitive'], ['search-word', 'wholeWord'], ['search-regex', 'regex']]) {
    $('#' + id).addEventListener('click', () => { opts[key] = !opts[key]; $('#' + id).classList.toggle('on', opts[key]); run(); });
  }
}
