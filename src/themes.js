// Temas de cores: converte JSON (formato VS Code ou formato simples "tokens") em tema do Monaco + variáveis CSS
import * as monaco from './gen/monaco-lite.js';
import { api } from './ui.js';

let current = null;
const listeners = new Set();
export const onThemeChange = fn => listeners.add(fn);
export const currentTheme = () => current;

// Formato simples "tokens" -> tokens do Monaco
const SIMPLE = {
  comment: ['comment'],
  string: ['string', 'attribute.value', 'string.value.json', 'string.html', 'string.sql'],
  number: ['number', 'attribute.value.number', 'attribute.value.unit', 'attribute.value.hex', 'number.hex', 'number.float'],
  keyword: ['keyword', 'keyword.flow', 'keyword.json', 'storage', 'metatag', 'metatag.content', 'keyword.md'],
  function: ['entity.name.function', 'support.function', 'predefined', 'predefined.sql'],
  type: ['type', 'type.identifier', 'entity.name.type', 'support.class', 'namespace'],
  tag: ['tag', 'metatag.html', 'tag.id.pug', 'tag.class.pug', 'entity.name.tag', 'selector'],
  attribute: ['attribute.name', 'attribute.name.html', 'entity.other.attribute-name'],
  property: ['attribute.name.css', 'attribute.name.scss', 'attribute.name.less', 'string.key.json', 'key', 'type.yaml', 'support.type.property-name'],
  regexp: ['regexp', 'string.regexp', 'string.escape'],
  delimiter: ['delimiter', 'delimiter.html', 'delimiter.bracket', 'delimiter.parenthesis', 'delimiter.square', 'delimiter.curly', 'punctuation', 'tag.delimiter'],
  variable: ['variable', 'variable.predefined', 'variable.parameter', 'identifier'],
  constant: ['constant', 'constant.language', 'keyword.constant'],
  operator: ['operator', 'operators', 'keyword.operator', 'delimiter.operator']
};

// Escopos TextMate (tokenColors do VS Code) -> tokens do Monaco (Monarch)
const SCOPE_ALIASES = {
  'comment': SIMPLE.comment,
  'string': SIMPLE.string,
  'constant.numeric': SIMPLE.number,
  'keyword': ['keyword', 'keyword.flow'],
  'storage': ['keyword'], 'storage.type': ['keyword'],
  'entity.name.function': SIMPLE.function, 'support.function': SIMPLE.function,
  'entity.name.type': SIMPLE.type, 'entity.name.class': SIMPLE.type, 'support.class': SIMPLE.type, 'support.type': SIMPLE.type,
  'entity.name.tag': SIMPLE.tag,
  'entity.other.attribute-name': SIMPLE.attribute,
  'support.type.property-name': SIMPLE.property, 'support.type.property-name.css': SIMPLE.property,
  'string.regexp': SIMPLE.regexp,
  'punctuation': SIMPLE.delimiter, 'punctuation.definition.tag': ['delimiter.html', 'tag.delimiter'],
  'variable': ['variable', 'identifier'], 'variable.other': ['identifier'],
  'constant.language': SIMPLE.constant,
  'keyword.operator': SIMPLE.operator,
  'markup.heading': ['keyword.md'], 'markup.bold': ['strong'], 'markup.italic': ['emphasis'],
  'markup.inline.raw': ['variable.source'], 'markup.underline.link': ['string.link']
};

const hexRe = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const norm = c => {
  if (typeof c !== 'string' || !hexRe.test(c.trim())) return null;
  let x = c.trim().slice(1);
  if (x.length <= 4) x = [...x].map(ch => ch + ch).join('');
  return x.toLowerCase();
};

function parseSimple(value) {
  const parts = String(value).trim().split(/\s+/);
  const color = parts.find(p => p.startsWith('#'));
  const style = parts.filter(p => /^(italic|bold|underline|strikethrough)$/.test(p)).join(' ');
  return { foreground: color, fontStyle: style || undefined };
}

function rule(token, settings) {
  const r = { token };
  const fg = norm(settings.foreground), bg = norm(settings.background);
  if (fg) r.foreground = fg;
  if (bg) r.background = bg;
  if (settings.fontStyle != null) r.fontStyle = settings.fontStyle;
  return r;
}

function buildRules(theme) {
  const alias = new Map(), direct = new Map();
  for (const tc of theme.tokenColors || []) {
    const s = tc.settings || {};
    if (!tc.scope) { if (s.foreground) direct.set('', s); continue; }
    const scopes = Array.isArray(tc.scope) ? tc.scope : String(tc.scope).split(',');
    for (let scope of scopes) {
      scope = scope.trim();
      if (!scope || scope.includes(' ')) continue; // seletores compostos não existem no Monaco
      direct.set(scope, { ...(direct.get(scope) || {}), ...s });
      for (const t of SCOPE_ALIASES[scope] || []) if (!alias.has(t)) alias.set(t, s);
    }
  }
  for (const [key, value] of Object.entries(theme.tokens || {})) {
    for (const t of SIMPLE[key] || [key]) direct.set(t, parseSimple(value));
  }
  const merged = new Map([...alias, ...direct]);
  return [...merged].map(([t, s]) => rule(t, s));
}

// ---- manipulação de cores ----
function toRgb(hex) {
  const x = norm(hex);
  if (!x) return null;
  return [parseInt(x.slice(0, 2), 16), parseInt(x.slice(2, 4), 16), parseInt(x.slice(4, 6), 16)];
}
function mix(a, b, t) {
  const A = toRgb(a), B = toRgb(b);
  if (!A || !B) return a || b;
  return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

export function buildUiVars(theme) {
  const c = theme.colors || {};
  const dark = theme.type !== 'light';
  const pick = (...keys) => { for (const k of keys) { if (k?.startsWith?.('#')) return k; if (c[k]) return c[k]; } return undefined; };
  const bg = pick('editor.background') || (dark ? '#1e1e1e' : '#ffffff');
  const fg = pick('editor.foreground', 'foreground') || (dark ? '#d4d4d4' : '#333333');
  const shade = (t) => mix(bg, dark ? '#000000' : '#000000', t);
  const tint = (t) => mix(bg, fg, t);
  const accent = pick('focusBorder', 'button.background', 'tab.activeBorderTop', 'activityBarBadge.background') || '#7c5cff';
  const sidebar = pick('sideBar.background') || shade(dark ? 0.12 : 0.03);
  return {
    '--bg': bg,
    '--fg': pick('foreground', 'editor.foreground') || fg,
    '--fg-muted': pick('descriptionForeground', 'tab.inactiveForeground') || mix(fg, bg, 0.45),
    '--accent': accent,
    '--accent-fg': pick('button.foreground') || '#ffffff',
    '--activity-bg': pick('activityBar.background') || shade(dark ? 0.2 : 0.05),
    '--activity-fg': pick('activityBar.foreground') || fg,
    '--activity-inactive': pick('activityBar.inactiveForeground') || mix(fg, bg, 0.6),
    '--sidebar-bg': sidebar,
    '--sidebar-fg': pick('sideBar.foreground', 'foreground') || mix(fg, bg, 0.15),
    '--hover': pick('list.hoverBackground') || mix(sidebar, fg, 0.07),
    '--selection': pick('list.activeSelectionBackground') || mix(sidebar, accent, 0.25),
    '--selection-fg': pick('list.activeSelectionForeground') || fg,
    '--tabs-bg': pick('editorGroupHeader.tabsBackground') || shade(dark ? 0.2 : 0.05),
    '--tab-active-bg': pick('tab.activeBackground') || bg,
    '--tab-active-fg': pick('tab.activeForeground') || fg,
    '--tab-inactive-bg': pick('tab.inactiveBackground', 'editorGroupHeader.tabsBackground') || shade(dark ? 0.2 : 0.05),
    '--tab-inactive-fg': pick('tab.inactiveForeground') || mix(fg, bg, 0.45),
    '--tab-border-top': pick('tab.activeBorderTop') || accent,
    '--tab-border': pick('tab.border') || shade(dark ? 0.35 : 0.08),
    '--status-bg': pick('statusBar.background') || shade(dark ? 0.2 : 0.05),
    '--status-fg': pick('statusBar.foreground') || mix(fg, bg, 0.3),
    '--status-hover': pick('statusBarItem.hoverBackground') || tint(0.1),
    '--live-bg': pick('statusBarItem.remoteBackground') || accent,
    '--panel-bg': pick('panel.background', 'terminal.background') || sidebar,
    '--border': pick('panel.border', 'editorGroup.border', 'contrastBorder') || tint(0.1),
    '--input-bg': pick('input.background') || tint(0.06),
    '--input-fg': pick('input.foreground') || fg,
    '--input-border': pick('input.border') || tint(0.12),
    '--widget-bg': pick('editorWidget.background', 'quickInput.background') || mix(bg, fg, 0.04),
    '--scroll': pick('scrollbarSlider.background') || (dark ? '#ffffff14' : '#00000014'),
    '--scroll-hover': pick('scrollbarSlider.hoverBackground') || (dark ? '#ffffff24' : '#00000024'),
    '--titlebar-bg': pick('titleBar.activeBackground', 'activityBar.background') || shade(dark ? 0.2 : 0.05),
    '--titlebar-fg': pick('titleBar.activeForeground') || mix(fg, bg, 0.3),
    '--shadow': dark ? 'rgba(0,0,0,.5)' : 'rgba(0,0,0,.15)',
    '--err': pick('editorError.foreground') || (dark ? '#ff6b6b' : '#d32f2f'),
    '--warn': pick('editorWarning.foreground') || (dark ? '#e5c07b' : '#b26a00'),
    '--info': pick('editorInfo.foreground') || (dark ? '#6cb6ff' : '#1565c0')
  };
}

export function terminalTheme(theme) {
  const c = theme.colors || {};
  const vars = buildUiVars(theme);
  const t = {
    background: c['terminal.background'] || vars['--panel-bg'],
    foreground: c['terminal.foreground'] || vars['--fg'],
    cursor: c['terminalCursor.foreground'] || c['editorCursor.foreground'] || vars['--fg'],
    selectionBackground: c['terminal.selectionBackground'] || c['editor.selectionBackground'] || '#44475a'
  };
  for (const n of ['Black', 'Red', 'Green', 'Yellow', 'Blue', 'Magenta', 'Cyan', 'White']) {
    if (c[`terminal.ansi${n}`]) t[n.toLowerCase()] = c[`terminal.ansi${n}`];
    if (c[`terminal.ansiBright${n}`]) t['bright' + n] = c[`terminal.ansiBright${n}`];
  }
  return t;
}

export async function applyTheme(id) {
  let theme;
  try { theme = await api.invoke('themes:read', id); } catch { return; }
  const vars = buildUiVars(theme);
  const colors = {};
  for (const [k, v] of Object.entries(theme.colors || {})) if (norm(v)) colors[k] = v;
  colors['editor.background'] ||= vars['--bg'];
  // fundo dos widgets segue a interface
  colors['editorWidget.background'] ||= vars['--widget-bg'];
  colors['editorSuggestWidget.background'] ||= vars['--widget-bg'];
  colors['editorHoverWidget.background'] ||= vars['--widget-bg'];
  const monacoId = 'lezx-' + String(theme.id).toLowerCase().replace(/[^a-z0-9]+/g, '-');
  monaco.editor.defineTheme(monacoId, {
    base: theme.type === 'light' ? 'vs' : theme.type === 'hc' ? 'hc-black' : 'vs-dark',
    inherit: true,
    rules: buildRules(theme),
    colors
  });
  monaco.editor.setTheme(monacoId);
  const root = document.documentElement.style;
  for (const [k, v] of Object.entries(vars)) root.setProperty(k, v);
  document.documentElement.dataset.theme = theme.type === 'light' ? 'light' : 'dark';
  api.send('app:titlebar', vars['--titlebar-bg'], vars['--titlebar-fg']); // botões da janela no Windows
  current = theme;
  for (const fn of listeners) fn(theme);
}
