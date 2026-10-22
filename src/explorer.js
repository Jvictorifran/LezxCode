// Explorador de arquivos
import { api, $, h, basename, dirname, join, relative, errorToast, contextMenu } from './ui.js';
import { state, emit } from './state.js';
import { fileIcon, onIconThemeChange } from './icons.js';
import { openFile, onRenamed, closeTab, tabs } from './editor.js';

const children = new Map(); // dir -> entries
const expanded = new Set();
let selected = null;
let editing = null; // { kind: 'new-file'|'new-folder'|'rename', dir, path }
const tree = () => $('#tree');

export async function setRoot(root) {
  state.root = root;
  children.clear();
  expanded.clear();
  selected = null;
  $('#explorer-title').textContent = root ? basename(root).toUpperCase() : 'EXPLORADOR';
  $('#no-folder').hidden = !!root;
  tree().hidden = !root;
  if (root) {
    expanded.add(root);
    for (const p of JSON.parse(localStorage.getItem('lezx.expanded:' + root) || '[]')) expanded.add(p);
    await load(root);
  }
  render();
  emit('root', root);
}

function persistExpanded() {
  try { localStorage.setItem('lezx.expanded:' + state.root, JSON.stringify([...expanded].filter(p => p !== state.root).slice(0, 300))); } catch {}
}

async function load(dir) {
  try { children.set(dir, await api.invoke('fs:readDir', dir)); }
  catch { children.delete(dir); expanded.delete(dir); }
  // carrega subpastas que estavam expandidas
  await Promise.all((children.get(dir) || []).filter(e => e.isDir && expanded.has(e.path) && !children.has(e.path)).map(e => load(e.path)));
}

export async function refresh(paths) {
  if (!state.root) return;
  const dirs = new Set();
  if (!paths) for (const d of children.keys()) dirs.add(d);
  else for (const p of paths) { dirs.add(dirname(p)); if (children.has(p)) dirs.add(p); }
  await Promise.all([...dirs].filter(d => children.has(d)).map(load));
  render();
}

function rows() {
  const out = [];
  const walk = (dir, depth) => {
    if (editing && editing.kind !== 'rename' && editing.dir === dir) out.push({ editRow: true, depth });
    for (const e of children.get(dir) || []) {
      out.push({ entry: e, depth });
      if (e.isDir && expanded.has(e.path)) walk(e.path, depth + 1);
    }
  };
  if (state.root) walk(state.root, 0);
  return out;
}

const PAD = 8, STEP = 12;

export function render() {
  const t = tree();
  const list = rows().map(({ entry, depth, editRow }) => {
    if (editRow) return editInput(depth, editing.kind === 'new-folder', '');
    const isEditing = editing?.kind === 'rename' && editing.path === entry.path;
    if (isEditing) return editInput(depth, entry.isDir, entry.name);
    const isOpen = entry.isDir && expanded.has(entry.path);
    const row = h('div', {
      class: `row${selected === entry.path ? ' selected' : ''}`,
      style: { paddingLeft: `${PAD + depth * STEP}px` },
      title: relative(state.root, entry.path),
      draggable: 'true',
      'data-path': entry.path
    },
      ...guides(depth),
      h('span', { class: 'twistie' }, entry.isDir ? h('i', { class: `codicon codicon-chevron-${isOpen ? 'down' : 'right'}` }) : null),
      fileIcon(entry.name, entry.isDir, isOpen),
      h('span', { class: 'name' }, entry.name)
    );
    row.addEventListener('click', () => onClick(entry));
    row.addEventListener('contextmenu', e => { e.preventDefault(); select(entry.path); menu(entry); });
    row.addEventListener('dragstart', e => { e.dataTransfer.setData('text/lezx-path', entry.path); e.dataTransfer.effectAllowed = 'move'; });
    if (entry.isDir) addDrop(row, entry.path);
    return row;
  });
  t.replaceChildren(...list);
  const input = t.querySelector('input');
  if (input) { input.focus(); const dot = input.value.lastIndexOf('.'); input.setSelectionRange(0, dot > 0 ? dot : input.value.length); }
}

function guides(depth) {
  const out = [];
  for (let i = 0; i < depth; i++) out.push(h('span', { class: 'indent-guide', style: { left: `${PAD + i * STEP + 7}px` } }));
  return out;
}

function addDrop(el, dir) {
  el.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('text/lezx-path')) { e.preventDefault(); el.classList.add('drop-target'); } });
  el.addEventListener('dragleave', () => el.classList.remove('drop-target'));
  el.addEventListener('drop', async e => {
    e.preventDefault(); e.stopPropagation();
    el.classList.remove('drop-target');
    const from = e.dataTransfer.getData('text/lezx-path');
    if (!from || from === dir || dirname(from) === dir || dir.startsWith(from + '/')) return;
    const to = join(dir, basename(from));
    try { await api.invoke('fs:rename', from, to); onRenamed(from, to); expanded.add(dir); await refresh([from, to]); }
    catch (err) { errorToast(err); }
  });
}

function editInput(depth, isDir, value) {
  const input = h('input', { value, spellcheck: 'false' });
  let done = false;
  const finish = async commit => {
    if (done) return; done = true;
    const name = input.value.trim();
    const ed = editing;
    editing = null;
    if (commit && name && !(ed.kind === 'rename' && name === basename(ed.path))) await commitEdit(ed, name);
    else render();
    tree().focus();
  };
  input.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
  return h('div', { class: 'row', style: { paddingLeft: `${PAD + depth * STEP}px` } },
    h('span', { class: 'twistie' }), fileIcon(value || (isDir ? 'pasta' : 'arquivo'), isDir), input);
}

async function commitEdit(ed, name) {
  try {
    if (ed.kind === 'rename') {
      const to = join(dirname(ed.path), name);
      await api.invoke('fs:rename', ed.path, to);
      onRenamed(ed.path, to);
      selected = to;
      await refresh([ed.path, to]);
    } else {
      const target = join(ed.dir, name); // aceita "pasta/sub/arquivo.js"
      if (ed.kind === 'new-folder') await api.invoke('fs:createDir', target);
      else await api.invoke('fs:createFile', target);
      // expande as pastas intermediárias
      let d = dirname(target);
      while (d.startsWith(state.root) && d !== state.root) { expanded.add(d); d = dirname(d); }
      selected = target;
      await refresh([target, ed.dir]);
      if (ed.kind === 'new-file') openFile(target);
    }
  } catch (e) { errorToast(e); render(); }
}

function select(p) { selected = p; render(); }

async function onClick(entry) {
  selected = entry.path;
  if (entry.isDir) {
    if (expanded.has(entry.path)) expanded.delete(entry.path);
    else { expanded.add(entry.path); if (!children.has(entry.path)) await load(entry.path); }
    persistExpanded();
    render();
  } else {
    render();
    openFile(entry.path);
  }
}

function targetDir() {
  if (!selected) return state.root;
  const entry = findEntry(selected);
  if (entry?.isDir) return entry.path;
  return dirname(selected);
}

function findEntry(p) {
  for (const list of children.values()) { const e = list.find(x => x.path === p); if (e) return e; }
  return null;
}

export async function startNew(kind) {
  if (!state.root) return;
  const dir = targetDir();
  if (!expanded.has(dir)) { expanded.add(dir); await load(dir); }
  editing = { kind, dir };
  render();
}

async function remove(entry) {
  const r = await api.invoke('dialog:confirm', {
    message: `Mover "${entry.name}" para o Lixo?`, detail: 'Você pode restaurá-lo pelo Lixo do macOS.', buttons: ['Mover para o Lixo', 'Cancelar']
  });
  if (r !== 0) return;
  try {
    await api.invoke('fs:trash', entry.path);
    for (const t of [...tabs]) if (t.path && (t.path === entry.path || t.path.startsWith(entry.path + '/')) && !t.dirty) await closeTab(t);
    if (selected === entry.path) selected = null;
    await refresh([entry.path]);
  } catch (e) { errorToast(e); }
}

async function duplicate(entry) {
  const dot = entry.isDir ? -1 : entry.name.lastIndexOf('.');
  const base = dot > 0 ? entry.name.slice(0, dot) : entry.name, ext = dot > 0 ? entry.name.slice(dot) : '';
  let n = 1, to;
  do { to = join(dirname(entry.path), `${base} cópia${n > 1 ? ' ' + n : ''}${ext}`); n++; } while (await api.invoke('fs:exists', to));
  try { await api.invoke('fs:copy', entry.path, to); selected = to; await refresh([to]); } catch (e) { errorToast(e); }
}

async function menu(entry) {
  const isHtml = /\.html?$/i.test(entry.name);
  const id = await contextMenu([
    { id: 'newFile', label: 'Novo arquivo…' }, { id: 'newFolder', label: 'Nova pasta…' }, { type: 'separator' },
    ...(isHtml ? [{ id: 'live', label: 'Abrir com Live Server' }, { type: 'separator' }] : []),
    { id: 'reveal', label: 'Mostrar no Finder' }, { id: 'terminal', label: 'Abrir no terminal integrado' }, { type: 'separator' },
    { id: 'copyPath', label: 'Copiar caminho' }, { id: 'copyRel', label: 'Copiar caminho relativo' }, { type: 'separator' },
    { id: 'rename', label: 'Renomear…' }, { id: 'duplicate', label: 'Duplicar' }, { id: 'delete', label: 'Mover para o Lixo' }
  ]);
  if (id === 'newFile') startNew('new-file');
  else if (id === 'newFolder') startNew('new-folder');
  else if (id === 'rename') { editing = { kind: 'rename', path: entry.path }; render(); }
  else if (id === 'delete') remove(entry);
  else if (id === 'duplicate') duplicate(entry);
  else if (id === 'reveal') api.invoke('shell:reveal', entry.path);
  else if (id === 'copyPath') navigator.clipboard.writeText(entry.path);
  else if (id === 'copyRel') navigator.clipboard.writeText(relative(state.root, entry.path));
  else if (id === 'terminal') emit('command', 'terminal.newAt', entry.isDir ? entry.path : dirname(entry.path));
  else if (id === 'live') emit('command', 'live.startFile', entry.path);
}

export function collapseAll() { expanded.clear(); if (state.root) expanded.add(state.root); persistExpanded(); render(); }

export async function reveal(p) {
  if (!state.root || !p?.startsWith(state.root + '/')) return;
  let d = dirname(p);
  const chain = [];
  while (d !== state.root && d.startsWith(state.root)) { chain.unshift(d); d = dirname(d); }
  for (const dir of chain) { expanded.add(dir); if (!children.has(dir)) await load(dir); }
  selected = p;
  render();
  tree().querySelector(`.row[data-path="${CSS.escape(p)}"]`)?.scrollIntoView({ block: 'nearest' });
}

export function initExplorer() {
  const t = tree();
  // soltar na área vazia = mover para a raiz
  t.addEventListener('drop', async e => {
    const from = e.dataTransfer.getData('text/lezx-path');
    if (!from || !state.root || dirname(from) === state.root) return;
    e.preventDefault();
    const to = join(state.root, basename(from));
    try { await api.invoke('fs:rename', from, to); onRenamed(from, to); await refresh([from, to]); } catch (err) { errorToast(err); }
  });
  t.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('text/lezx-path')) e.preventDefault(); });
  t.addEventListener('contextmenu', async e => {
    if (e.target !== t) return;
    e.preventDefault();
    selected = null;
    const id = await contextMenu([{ id: 'newFile', label: 'Novo arquivo…' }, { id: 'newFolder', label: 'Nova pasta…' }, { type: 'separator' }, { id: 'reveal', label: 'Mostrar no Finder' }]);
    if (id === 'newFile') startNew('new-file');
    else if (id === 'newFolder') startNew('new-folder');
    else if (id === 'reveal') api.invoke('shell:openPath', state.root);
  });
  t.addEventListener('keydown', e => {
    if (editing) return;
    const flat = rows().filter(r => r.entry).map(r => r.entry);
    const i = flat.findIndex(x => x.path === selected);
    const cur = flat[i];
    if (e.key === 'ArrowDown') { e.preventDefault(); select(flat[Math.min(i + 1, flat.length - 1)]?.path); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); select(flat[Math.max(i - 1, 0)]?.path); }
    else if (e.key === 'ArrowRight' && cur?.isDir && !expanded.has(cur.path)) onClick(cur);
    else if (e.key === 'ArrowLeft' && cur) { if (cur.isDir && expanded.has(cur.path)) onClick(cur); else select(dirname(cur.path) === state.root ? cur.path : dirname(cur.path)); }
    else if (e.key === 'Enter' && cur) { editing = { kind: 'rename', path: cur.path }; render(); }
    else if (e.key === ' ' && cur) { e.preventDefault(); onClick(cur); }
    else if (e.key === 'Backspace' && e.metaKey && cur) remove(cur);
    else if (e.key === 'o' && e.metaKey && cur && !cur.isDir) { e.preventDefault(); openFile(cur.path); }
  });
  onIconThemeChange(render);
  document.querySelector('#view-explorer .view-actions').addEventListener('click', e => {
    const a = e.target.closest('button')?.dataset.action;
    if (a === 'newFile') startNew('new-file');
    else if (a === 'newFolder') startNew('new-folder');
    else if (a === 'refresh') refresh();
    else if (a === 'collapse') collapseAll();
  });
}
