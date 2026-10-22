// Utilitários de interface compartilhados
export const api = window.lezx;
export const IS_MAC = api.platform === 'darwin';
export const IS_WIN = api.platform === 'win32';
// tecla "principal": ⌘ no Mac, Ctrl no Windows
export const isMod = e => (IS_MAC ? e.metaKey : e.ctrlKey);
export const REVEAL_LABEL = IS_MAC ? 'Mostrar no Finder' : 'Mostrar no Explorador de Arquivos';
export const TRASH = IS_MAC ? 'o Lixo' : 'a Lixeira'; // "para o Lixo" / "para a Lixeira"

// "⇧⌘P" -> "Ctrl+Shift+P" fora do Mac (os textos da interface são escritos com os símbolos do Mac)
const SYM = { '⌃': 'Ctrl', '⌘': 'Ctrl', '⇧': 'Shift', '⌥': 'Alt' };
export function kb(text) {
  if (IS_MAC || typeof text !== 'string' || !/[⌘⌥⇧⌃⌫↵]/.test(text)) return text;
  return text.replace(/([⌘⌥⇧⌃]+)([^\s⌘⌥⇧⌃,)/]*)/g, (_, mods, key) => {
    const set = new Set([...mods].map(m => SYM[m]));
    const parts = ['Ctrl', 'Shift', 'Alt'].filter(m => set.has(m));
    return key ? parts.join('+') + '+' + key : parts.join('+');
  }).replace(/⌫/g, 'Backspace').replace(/↵/g, 'Enter');
}

// converte textos, dicas e placeholders da interface (nunca dentro do editor ou do terminal)
export function localizeKeys(root = document.body) {
  if (IS_MAC) return;
  const fix = node => {
    if (node.nodeType === 3) { if (/[⌘⌥⇧⌃]/.test(node.nodeValue) && !node.parentElement?.closest('.monaco-editor, .xterm')) node.nodeValue = kb(node.nodeValue); return; }
    if (node.nodeType !== 1 || node.closest('.monaco-editor, .xterm')) return;
    for (const a of ['title', 'placeholder']) if (node.hasAttribute?.(a)) { const v = node.getAttribute(a); const n = kb(v); if (n !== v) node.setAttribute(a, n); }
    for (const c of node.childNodes) fix(c);
  };
  fix(root);
  new MutationObserver(records => {
    for (const r of records) {
      if (r.type === 'characterData') fix(r.target);
      else if (r.type === 'attributes') fix(r.target);
      else for (const n of r.addedNodes) fix(n);
    }
  }).observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['title', 'placeholder'] });
}
export const $ = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(c));
  return el;
}

export const basename = p => p.split('/').filter(Boolean).pop() || p;
export const dirname = p => { const i = p.lastIndexOf('/'); return i < 0 ? '.' : i === 0 ? '/' : p.slice(0, i); };
export const join = (...parts) => parts.join('/').replace(/\/+/g, '/');
export const relative = (root, p) => (root && p.startsWith(root + '/') ? p.slice(root.length + 1) : p);

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function toast(message, type = 'info', ms = 3500) {
  const icon = type === 'error' ? 'error' : type === 'warn' ? 'warning' : 'info';
  const el = h('div', { class: `toast ${type}` }, h('i', { class: `codicon codicon-${icon}` }), h('div', {}, message));
  $('#toasts').append(el);
  setTimeout(() => el.remove(), ms);
}

export function errorToast(e) { toast(String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'error', 6000); }

export async function contextMenu(items) { return api.invoke('menu:context', items.map(it => (it.label ? { ...it, label: kb(it.label) } : it))); }

// arrastar para redimensionar
export function makeSash(sash, { axis, get, set, onEnd }) {
  sash.addEventListener('mousedown', e => {
    e.preventDefault();
    const start = axis === 'x' ? e.clientX : e.clientY;
    const startVal = get();
    sash.classList.add('active');
    document.body.style.cursor = axis === 'x' ? 'ew-resize' : 'ns-resize';
    const move = ev => set(startVal + ((axis === 'x' ? ev.clientX : ev.clientY) - start));
    const up = () => {
      sash.classList.remove('active');
      document.body.style.cursor = '';
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      onEnd?.();
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });
}

export const store = {
  get(k, d) { try { const v = localStorage.getItem('lezx.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('lezx.' + k, JSON.stringify(v)); } catch {} }
};
