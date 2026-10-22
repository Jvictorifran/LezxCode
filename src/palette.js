// Paleta de comandos / Quick Open / seletor genérico
import { $, h } from './ui.js';

let cfg = null;
let items = [];
let index = 0;
const input = () => $('#palette-input');

// busca difusa: retorna pontuação e posições casadas (ou null)
export function fuzzy(query, text) {
  if (!query) return { score: 0, hits: [] };
  const q = query.toLowerCase(), t = text.toLowerCase();
  let qi = 0, score = 0, last = -2;
  const hits = [];
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) {
      hits.push(i);
      score += i === last + 1 ? 5 : 1;
      if (i === 0 || '/._- '.includes(t[i - 1])) score += 4;
      last = i; qi++;
    }
  }
  if (qi < q.length) return null;
  return { score: score - t.length * 0.01, hits };
}

function highlight(text, hits = []) {
  if (!hits.length) return [text];
  const set = new Set(hits), out = [];
  let buf = '', inHit = false;
  for (let i = 0; i < text.length; i++) {
    const hit = set.has(i);
    if (hit !== inHit) { if (buf) out.push(inHit ? h('b', {}, buf) : buf); buf = ''; inHit = hit; }
    buf += text[i];
  }
  if (buf) out.push(inHit ? h('b', {}, buf) : buf);
  return out;
}

/**
 * open({ placeholder, value, items: [{label, description, detail, icon, key, ...}] | (query) => items,
 *        onSelect(item, query), onHighlight(item), onCancel(), filter: true })
 */
export function openPalette(options) {
  cfg = { filter: true, ...options };
  $('#palette').hidden = false;
  const inp = input();
  inp.placeholder = cfg.placeholder || '';
  inp.value = cfg.value || '';
  update();
  inp.focus();
  if (cfg.selectPrefix) inp.setSelectionRange(cfg.selectPrefix, inp.value.length);
}

export function closePalette(cancel = true) {
  if (!cfg) return;
  const c = cfg;
  cfg = null;
  $('#palette').hidden = true;
  if (cancel) c.onCancel?.();
  document.dispatchEvent(new CustomEvent('lezx:focus-editor'));
}

function update() {
  if (!cfg) return;
  const raw = input().value;
  if (cfg.onInput && cfg.onInput(raw) === false) return;
  const q = cfg.prefix && raw.startsWith(cfg.prefix) ? raw.slice(cfg.prefix.length) : raw;
  let list = typeof cfg.items === 'function' ? cfg.items(q) : cfg.items;
  if (cfg.filter) {
    const scored = [];
    for (const it of list) {
      const m = fuzzy(q.trim(), it.label) || (it.description && fuzzy(q.trim(), it.label + ' ' + it.description));
      if (m) scored.push({ ...it, _hits: m.hits, _score: m.score });
    }
    if (q.trim()) scored.sort((a, b) => b._score - a._score);
    list = scored;
  }
  items = list.slice(0, 200);
  index = Math.max(0, items.findIndex(i => i.picked));
  render();
}

function render() {
  const box = $('#palette-list');
  if (!items.length) { box.replaceChildren(h('div', { class: 'pi-empty' }, cfg.emptyText || 'Nenhum resultado')); return; }
  let lastGroup = null;
  const nodes = [];
  items.forEach((it, i) => {
    if (it.group && it.group !== lastGroup && !input().value.replace(cfg.prefix || '', '').trim()) { nodes.push(h('div', { class: 'pi-sep' }, it.group)); }
    lastGroup = it.group;
    nodes.push(h('div', {
      class: `pi${i === index ? ' active' : ''}`,
      onmousemove: () => { if (index !== i) { index = i; mark(); } },
      onmousedown: e => { e.preventDefault(); index = i; accept(); }
    },
      it.icon || null,
      h('span', { class: 'pl' }, ...highlight(it.label, it._hits?.filter(x => x < it.label.length))),
      it.description ? h('span', { class: 'pd' }, it.description) : null,
      it.key ? h('span', { class: 'pk' }, ...it.key.split(' ').map(k => h('kbd', {}, k))) : null
    ));
  });
  box.replaceChildren(...nodes);
  mark();
}

function mark() {
  const els = [...$('#palette-list').querySelectorAll('.pi')];
  els.forEach((el, i) => el.classList.toggle('active', i === index));
  els[index]?.scrollIntoView({ block: 'nearest' });
  cfg?.onHighlight?.(items[index]);
}

function accept() {
  const it = items[index];
  const c = cfg;
  const q = input().value;
  if (!c) return;
  if (!it && !c.acceptEmpty) return;
  closePalette(false);
  c.onSelect?.(it, q);
}

export function initPalette() {
  const inp = input();
  inp.addEventListener('input', update);
  inp.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); index = Math.min(items.length - 1, index + 1); mark(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); index = Math.max(0, index - 1); mark(); }
    else if (e.key === 'PageDown') { e.preventDefault(); index = Math.min(items.length - 1, index + 10); mark(); }
    else if (e.key === 'PageUp') { e.preventDefault(); index = Math.max(0, index - 10); mark(); }
    else if (e.key === 'Enter') { e.preventDefault(); accept(); }
    else if (e.key === 'Escape') { e.preventDefault(); closePalette(true); }
  });
  inp.addEventListener('blur', () => setTimeout(() => { if (cfg && document.activeElement !== inp) closePalette(true); }, 100));
  $('#palette').addEventListener('mousedown', e => { if (e.target.id === 'palette') { e.preventDefault(); closePalette(true); } });
}

export const paletteOpen = () => !!cfg;
