// Carrega as fontes importadas pelo usuário (pasta "fonts" do Lezx Code) no documento
import { api } from './ui.js';
import { emit } from './state.js';

const loaded = new Map(); // nome do arquivo -> FontFace
let systemList = null;

export async function loadUserFonts() {
  let list = [];
  try { list = await api.invoke('fonts:list'); } catch { return []; }
  const names = new Set(list.map(f => f.name));
  for (const [name, face] of loaded) if (!names.has(name)) { document.fonts.delete(face); loaded.delete(name); }
  await Promise.all(list.filter(f => !loaded.has(f.name)).map(async f => {
    try {
      const face = new FontFace(f.family, `url("${f.url}")`, { weight: String(f.weight || 400), style: f.italic ? 'italic' : 'normal' });
      await face.load();
      document.fonts.add(face);
      loaded.set(f.name, face);
    } catch (e) { console.warn('fonte inválida', f.name, e); }
  }));
  emit('fonts', list);
  return list;
}

export async function systemFonts() {
  systemList ??= await api.invoke('fonts:system').catch(() => []);
  return systemList;
}

// "'Fira Code', Menlo, monospace" -> "Fira Code"
export function primaryFamily(css = '') {
  const first = String(css).split(',')[0]?.trim() || '';
  return first.replace(/^['"]|['"]$/g, '');
}

export function composeFamily(family, kind) {
  const fallback = kind === 'ui' ? "-apple-system, BlinkMacSystemFont, system-ui, sans-serif" : "'SF Mono', Menlo, monospace";
  return `'${family.replace(/'/g, '')}', ${fallback}`;
}
