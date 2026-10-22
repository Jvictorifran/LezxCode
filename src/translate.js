// Tradução das mensagens de erro (regras em JSON: translations/pt-BR.json + pasta do usuário)
import { api, toast } from './ui.js';
import { state, emit, on } from './state.js';

let rules = [];
const LANG_GROUPS = { c: ['c', 'cpp'], cpp: ['cpp'], javascript: ['javascript', 'typescript'], typescript: ['typescript'] };
const FIX_SUFFIX = /\s*\(fix available\)$/i;

export const enabled = () => state.settings['editor.translateErrors'] !== false;

export async function loadTranslations() {
  let list = [];
  try { list = await api.invoke('translations:list'); } catch { return; }
  rules = [];
  for (const r of list) {
    try {
      rules.push({ re: new RegExp(`^(?:${r.match})$`, r.caseSensitive ? '' : 'i'), replace: r.replace, langs: r.lang ? (LANG_GROUPS[r.lang] || [r.lang]) : null });
    } catch { if (r.source === 'user') toast(`Regra de tradução inválida em ${r.file}: ${r.match}`, 'error', 6000); }
  }
  emit('translations');
}

function translateLine(text, lang) {
  for (const r of rules) {
    if (r.langs && lang && !r.langs.includes(lang)) continue;
    if (r.re.test(text)) return text.replace(r.re, r.replace);
  }
  return null;
}

// devolve a mensagem traduzida, ou null se nenhuma regra casar
export function translate(message, lang) {
  if (!enabled() || !rules.length || !message) return null;
  const [first, ...rest] = String(message).split('\n');
  const fix = FIX_SUFFIX.test(first);
  const base = first.replace(FIX_SUFFIX, '').trim();
  const t = translateLine(base, lang);
  if (t == null) return null;
  return [t + (fix ? ' (correção disponível: ⌘.)' : ''), ...rest].join('\n');
}

// texto para o marcador: tradução em cima, original embaixo (aparece ao passar o mouse)
export function markerMessage(message, lang) {
  const t = translate(message, lang);
  return t ? `${t}\n\nOriginal: ${message}` : message;
}

export function initTranslations() {
  api.on('translations:changed', loadTranslations);
  api.on('translations:error', f => toast(`Erro de sintaxe no JSON de traduções: ${f}`, 'error', 6000));
  let last = enabled();
  on('settings', () => { if (enabled() !== last) { last = enabled(); emit('translations'); } });
  return loadTranslations();
}
