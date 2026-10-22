// Temas de ícones (arquivos e pastas) definidos em JSON
import { api, h } from './ui.js';

let theme = { iconDefinitions: {} };
const listeners = new Set();
export const onIconThemeChange = fn => listeners.add(fn);

export async function applyIconTheme(id) {
  try { theme = await api.invoke('iconThemes:read', id); } catch { return; }
  theme.fileNames = lowerKeys(theme.fileNames);
  theme.folderNames = lowerKeys(theme.folderNames);
  theme.folderNamesExpanded = lowerKeys(theme.folderNamesExpanded);
  theme.fileExtensions = lowerKeys(theme.fileExtensions);
  for (const fn of listeners) fn(theme);
}

function lowerKeys(o = {}) {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k.toLowerCase(), v]));
}

function resolveId(name, isDir, expanded) {
  const n = name.toLowerCase();
  if (isDir) {
    if (expanded) return theme.folderNamesExpanded?.[n] || theme.folderNames?.[n] || theme.folderExpanded || theme.folder;
    return theme.folderNames?.[n] || theme.folder;
  }
  if (theme.fileNames?.[n]) return theme.fileNames[n];
  // tenta da extensão mais longa para a mais curta: "comp.test.js" -> "test.js" -> "js"
  const parts = n.split('.');
  for (let i = 1; i < parts.length; i++) {
    const ext = parts.slice(i).join('.');
    if (theme.fileExtensions?.[ext]) return theme.fileExtensions[ext];
  }
  return theme.file;
}

export function fileIcon(name, isDir = false, expanded = false) {
  const def = theme.iconDefinitions?.[resolveId(name, isDir, expanded)];
  const fallback = isDir ? (expanded ? 'folder-opened' : 'folder') : 'file';
  if (!def) return h('span', { class: 'ficon' }, h('i', { class: `codicon codicon-${fallback}` }));
  const style = def.color ? { color: def.color } : null;
  if (def.src) return h('span', { class: 'ficon' }, h('img', { src: def.src, alt: '' }));
  if (def.svg) {
    const clean = String(def.svg).replace(/<script[\s\S]*?<\/script>/gi, '');
    return h('span', { class: 'ficon' }, h('img', { src: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(clean), alt: '' }));
  }
  if (def.text != null) {
    const t = String(def.text);
    return h('span', { class: `ficon text${t.length >= 3 ? ' len3' : ''}`, style: { ...style, ...(def.background ? { background: def.background, borderRadius: '3px' } : {}) } }, t);
  }
  return h('span', { class: 'ficon', style }, h('i', { class: `codicon codicon-${def.codicon || fallback}` }));
}
