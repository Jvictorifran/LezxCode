// Tela de Configurações (interface visual para o settings.json)
import { api, $, h, toast, errorToast } from './ui.js';
import { state, on, emit } from './state.js';
import { loadUserFonts, systemFonts, primaryFamily, composeFamily } from './fonts.js';

const PREVIEW = "const lezx = () => 'Olá, mundo!'; // 0O 1lI {} [] => !== ->";

const SECTIONS = [
  { id: 'aparencia', title: 'Aparência', icon: 'symbol-color', items: [
    { key: 'workbench.colorTheme', label: 'Tema de cores', type: 'colorTheme' },
    { key: 'workbench.iconTheme', label: 'Tema de ícones', desc: 'Ícones de arquivos e pastas no explorador e nas abas.', type: 'iconTheme' },
    { key: 'workbench.sideBar.location', label: 'Posição da barra lateral', desc: 'Lado em que ficam o explorador de arquivos e a barra de atividades.', type: 'segmented', options: [['left', 'Esquerda'], ['right', 'Direita']] },
    { key: 'workbench.fontFamily', label: 'Fonte da interface', desc: 'Menus, explorador, abas e barra de status.', type: 'font', kind: 'ui' },
    { key: 'workbench.fontSize', label: 'Tamanho da fonte da interface', type: 'number', min: 10, max: 20 }
  ] },
  { id: 'editor', title: 'Editor', icon: 'code', items: [
    { key: 'editor.fontFamily', label: 'Fonte do editor', type: 'font', kind: 'mono' },
    { key: 'editor.fontSize', label: 'Tamanho da fonte', type: 'number', min: 8, max: 40 },
    { key: 'editor.lineHeight', label: 'Altura da linha', desc: '0 = automático. Valores até 8 multiplicam o tamanho da fonte (ex.: 1.6).', type: 'number', min: 0, max: 60, step: 0.1 },
    { key: 'editor.fontLigatures', label: 'Ligaduras de fonte', desc: 'Junta símbolos como => e !== em um só desenho (a fonte precisa suportar, ex.: Fira Code).', type: 'toggle' },
    { key: 'editor.tabSize', label: 'Tamanho da tabulação', type: 'select', options: [[2, '2 espaços'], [4, '4 espaços'], [8, '8 espaços']] },
    { key: 'editor.insertSpaces', label: 'Usar espaços em vez de tabs', type: 'toggle' },
    { key: 'editor.wordWrap', label: 'Quebra de linha', type: 'toggle', on: 'on', off: 'off' },
    { key: 'editor.minimap', label: 'Minimapa', type: 'toggle' },
    { key: 'editor.lineNumbers', label: 'Números de linha', type: 'select', options: [['on', 'Mostrar'], ['relative', 'Relativos'], ['off', 'Ocultar']] },
    { key: 'editor.cursorStyle', label: 'Estilo do cursor', type: 'select', options: [['line', 'Linha'], ['block', 'Bloco'], ['underline', 'Sublinhado'], ['line-thin', 'Linha fina']] },
    { key: 'editor.cursorBlinking', label: 'Animação do cursor', type: 'select', options: [['smooth', 'Suave'], ['blink', 'Piscar'], ['phase', 'Fase'], ['expand', 'Expandir'], ['solid', 'Fixo']] },
    { key: 'editor.renderWhitespace', label: 'Mostrar espaços em branco', type: 'select', options: [['none', 'Nunca'], ['selection', 'Na seleção'], ['boundary', 'Nas bordas'], ['all', 'Sempre']] },
    { key: 'editor.bracketPairColorization', label: 'Colorir pares de chaves', type: 'toggle' },
    { key: 'editor.stickyScroll', label: 'Rolagem fixa', desc: 'Mantém visível no topo a função ou bloco em que você está.', type: 'toggle' },
    { key: 'editor.errorLens', label: 'Erros na linha', desc: 'Mostra a mensagem de erro/aviso no fim da própria linha, sem precisar passar o mouse.', type: 'select', options: [['all', 'Erros e avisos'], ['errors', 'Só erros'], ['off', 'Desligado (só ao passar o mouse)']] },
    { key: 'editor.translateErrors', label: 'Traduzir erros para português', desc: 'Traduz as mensagens mais comuns de C, Python, PHP e JS. A original em inglês continua aparecendo ao passar o mouse. Você pode adicionar as suas traduções.', type: 'toggle', extra: () => h('button', { class: 'btn ghost small', style: { marginLeft: '12px' }, onclick: () => emit('command', 'translations.edit') }, h('i', { class: 'codicon codicon-edit' }), ' Minhas traduções') },
    { key: 'editor.formatOnSave', label: 'Formatar ao salvar', type: 'toggle' }
  ] },
  { id: 'arquivos', title: 'Arquivos', icon: 'files', items: [
    { key: 'files.autoSave', label: 'Salvamento automático', type: 'select', options: [['off', 'Desligado'], ['afterDelay', 'Após um intervalo'], ['onFocusChange', 'Ao sair do editor']] },
    { key: 'files.autoSaveDelay', label: 'Intervalo do salvamento automático (ms)', type: 'number', min: 100, max: 60000, step: 100 },
    { key: 'files.exclude', label: 'Ocultar no explorador', desc: 'Nomes separados por vírgula.', type: 'list' },
    { key: 'search.exclude', label: 'Ignorar na pesquisa e no ⌘P', desc: 'Nomes separados por vírgula.', type: 'list' }
  ] },
  { id: 'terminal', title: 'Terminal', icon: 'terminal', items: [
    { key: 'terminal.fontFamily', label: 'Fonte do terminal', desc: 'Para prompts com ícones (oh-my-zsh, powerlevel10k, starship), use uma Nerd Font.', type: 'font', kind: 'mono' },
    { key: 'terminal.fontSize', label: 'Tamanho da fonte', type: 'number', min: 8, max: 40 },
    { key: 'terminal.lineHeight', label: 'Altura da linha', type: 'number', min: 1, max: 2, step: 0.05 },
    { key: 'terminal.cursorStyle', label: 'Estilo do cursor', type: 'select', options: [['block', 'Bloco'], ['bar', 'Barra'], ['underline', 'Sublinhado']] },
    { key: 'terminal.shell', label: 'Shell', desc: 'Vazio = shell padrão do sistema ($SHELL). Ex.: /bin/bash', type: 'text', placeholder: '/bin/zsh' }
  ] },
  { id: 'live', title: 'Live Server', icon: 'broadcast', items: [
    { key: 'liveServer.port', label: 'Porta', desc: 'Se estiver ocupada, a próxima porta livre é usada.', type: 'number', min: 1024, max: 65535 },
    { key: 'liveServer.openBrowser', label: 'Abrir o navegador ao iniciar', type: 'toggle' }
  ] },
  { id: 'fontes', title: 'Fontes', icon: 'text-size', custom: renderFontsSection }
];

let defaults = {};
let query = '';
let built = false;
let themeLists = { color: [], icon: [] };
let fontLists = { user: [], system: [] };

const isModified = key => JSON.stringify(state.settings[key]) !== JSON.stringify(defaults[key]);
const set = (key, value) => api.invoke('settings:set', { [key]: value }).catch(errorToast);
const reset = key => api.invoke('settings:reset', [key]).catch(errorToast);

function control(item) {
  const v = state.settings[item.key];
  switch (item.type) {
    case 'toggle': {
      const checked = item.on ? v === item.on : !!v;
      return h('label', { class: 'switch' },
        h('input', { type: 'checkbox', checked, onchange: e => set(item.key, item.on ? (e.target.checked ? item.on : item.off) : e.target.checked) }),
        h('span', { class: 'slider' }));
    }
    case 'segmented':
      return h('div', { class: 'segmented' }, ...item.options.map(([val, label]) =>
        h('button', { class: v === val ? 'on' : '', onclick: () => set(item.key, val) }, label)));
    case 'select': {
      const sel = h('select', { onchange: e => { const o = item.options[e.target.selectedIndex]; set(item.key, o[0]); } },
        ...item.options.map(([val, label]) => h('option', { selected: String(val) === String(v) }, label)));
      return sel;
    }
    case 'number':
      return h('input', { type: 'number', class: 'num', value: v ?? '', min: item.min, max: item.max, step: item.step || 1,
        onchange: e => { const n = Number(e.target.value); if (!Number.isNaN(n)) set(item.key, Math.min(item.max ?? Infinity, Math.max(item.min ?? -Infinity, n))); } });
    case 'text':
      return h('input', { type: 'text', class: 'txt', value: v ?? '', placeholder: item.placeholder || '', spellcheck: 'false', onchange: e => set(item.key, e.target.value.trim()) });
    case 'list':
      return h('input', { type: 'text', class: 'txt wide', value: (v || []).join(', '), spellcheck: 'false',
        onchange: e => set(item.key, e.target.value.split(',').map(x => x.trim()).filter(Boolean)) });
    case 'colorTheme':
    case 'iconTheme': {
      const list = item.type === 'colorTheme' ? themeLists.color : themeLists.icon;
      const groups = item.type === 'colorTheme'
        ? [['Temas escuros', list.filter(t => t.type !== 'light' && t.source !== 'user')], ['Temas claros', list.filter(t => t.type === 'light' && t.source !== 'user')], ['Meus temas', list.filter(t => t.source === 'user')]]
        : [['Embutidos', list.filter(t => t.source !== 'user')], ['Meus temas', list.filter(t => t.source === 'user')]];
      return h('div', { class: 'ctl-row' },
        h('select', { onchange: e => set(item.key, e.target.value) },
          ...groups.filter(([, l]) => l.length).map(([g, l]) => h('optgroup', { label: g }, ...l.map(t => h('option', { value: t.id, selected: t.id === v }, t.name))))),
        h('button', { class: 'btn ghost small', title: 'Abrir pasta dos seus temas', onclick: () => emit('command', item.type === 'colorTheme' ? 'theme.openFolder' : 'theme.openIconFolder') }, h('i', { class: 'codicon codicon-folder-opened' })),
        item.type === 'colorTheme' ? h('button', { class: 'btn ghost small', onclick: () => emit('command', 'theme.new') }, h('i', { class: 'codicon codicon-add' }), ' Criar tema') : null);
    }
    case 'font': return fontControl(item, v);
  }
  return null;
}

function fontControl(item, v) {
  const current = primaryFamily(v);
  const isDefault = !isModified(item.key);
  const user = [...new Set(fontLists.user.map(f => f.family))];
  const mono = fontLists.system.filter(f => f.mono).map(f => f.family);
  const other = fontLists.system.filter(f => !f.mono).map(f => f.family);
  const known = new Set([...user, ...mono, ...other]);
  const opt = fam => h('option', { value: fam, selected: !isDefault && fam === current }, fam);
  const groups = item.kind === 'ui'
    ? [['Importadas', user], ['Fontes do sistema', [...other, ...mono]]]
    : [['Importadas', user], ['Monoespaçadas', mono], ['Outras fontes', other]];
  const sel = h('select', {
    class: 'font-select',
    onchange: e => {
      if (e.target.value === '__default') reset(item.key);
      else if (e.target.value === '__import') { e.target.value = isDefault ? '__default' : current; importFonts(); }
      else set(item.key, composeFamily(e.target.value, item.kind));
    }
  },
    h('option', { value: '__default', selected: isDefault }, `Padrão (${item.kind === 'ui' ? 'Sistema' : primaryFamily(defaults[item.key])})`),
    !isDefault && current && !known.has(current) ? h('option', { value: current, selected: true }, current) : null,
    ...groups.filter(([, l]) => l.length).map(([g, l]) => h('optgroup', { label: g }, ...l.map(opt))),
    h('optgroup', { label: '—' }, h('option', { value: '__import' }, 'Importar fonte…')));
  return h('div', { class: 'font-ctl' },
    h('div', { class: 'ctl-row' }, sel),
    h('div', { class: 'font-preview', style: { fontFamily: v } }, item.kind === 'ui' ? 'Explorador · Abas · Barra de status — Lezx Code' : PREVIEW));
}

async function importFonts() {
  try {
    const added = await api.invoke('fonts:import');
    if (!added.length) return;
    await refreshFonts();
    toast(`${added.length} fonte(s) importada(s). Escolha-as nas listas de fontes.`);
  } catch (e) { errorToast(e); }
}

function renderFontsSection() {
  const byFamily = new Map();
  for (const f of fontLists.user) {
    if (!byFamily.has(f.family)) byFamily.set(f.family, []);
    byFamily.get(f.family).push(f);
  }
  return h('div', { class: 'fonts-box' },
    h('p', { class: 'set-desc' }, 'Importe arquivos .ttf, .otf, .ttc, .woff ou .woff2. Eles são copiados para a pasta do Lezx Code e ficam disponíveis no editor, no terminal e na interface (não é preciso instalar no macOS).'),
    h('div', { class: 'ctl-row' },
      h('button', { class: 'btn', onclick: importFonts }, h('i', { class: 'codicon codicon-cloud-download' }), ' Importar fontes…'),
      h('button', { class: 'btn ghost', onclick: () => api.invoke('fonts:openFolder') }, h('i', { class: 'codicon codicon-folder-opened' }), ' Abrir pasta de fontes')),
    byFamily.size
      ? h('div', { class: 'font-list' }, ...[...byFamily].map(([family, files]) => h('div', { class: 'font-item' },
        h('div', { class: 'font-item-head' },
          h('b', {}, family),
          h('span', { class: 'set-desc' }, `${files.length} arquivo(s)${files.some(f => f.mono) ? ' · monoespaçada' : ''}`),
          h('div', { class: 'font-actions' },
            h('button', { class: 'btn ghost small', onclick: () => set('editor.fontFamily', composeFamily(family, 'mono')) }, 'Usar no editor'),
            h('button', { class: 'btn ghost small', onclick: () => set('terminal.fontFamily', composeFamily(family, 'mono')) }, 'Usar no terminal'),
            h('button', { class: 'btn ghost small danger', title: 'Remover', onclick: async () => { for (const f of files) await api.invoke('fonts:remove', f.name); await refreshFonts(); } }, h('i', { class: 'codicon codicon-trash' })))),
        h('div', { class: 'font-preview', style: { fontFamily: `'${family}'` } }, PREVIEW))))
      : h('p', { class: 'set-desc empty' }, 'Nenhuma fonte importada ainda.'));
}

async function refreshFonts() {
  fontLists.user = await loadUserFonts();
  render();
}

async function refreshLists() {
  const [color, icon, system] = await Promise.all([api.invoke('themes:list'), api.invoke('iconThemes:list'), systemFonts()]);
  themeLists = { color, icon };
  fontLists.system = system;
}

function matches(item) {
  if (!query) return true;
  const q = query.toLowerCase();
  return [item.label, item.desc, item.key].some(t => t && t.toLowerCase().includes(q));
}

export function render() {
  const root = $('#settings-view');
  if (root.hidden && built) return;
  const content = $('#settings-content');
  if (!content) return;
  const scroll = content.scrollTop;
  const sections = SECTIONS.map(sec => {
    if (sec.custom) return (!query || 'fontes importar'.includes(query.toLowerCase())) ? h('section', { class: 'set-section', id: 'sec-' + sec.id }, h('h2', {}, sec.title), sec.custom()) : null;
    const items = sec.items.filter(matches);
    if (!items.length) return null;
    return h('section', { class: 'set-section', id: 'sec-' + sec.id }, h('h2', {}, sec.title),
      ...items.map(item => h('div', { class: `set-item${isModified(item.key) ? ' modified' : ''}` },
        h('div', { class: 'set-head' },
          h('span', { class: 'set-label' }, item.label),
          isModified(item.key) ? h('button', { class: 'reset', title: 'Restaurar padrão', onclick: () => reset(item.key) }, h('i', { class: 'codicon codicon-discard' })) : null),
        item.desc ? h('div', { class: 'set-desc' }, item.desc) : null,
        h('div', { class: 'set-ctl' }, control(item), item.extra?.()))));
  }).filter(Boolean);
  content.replaceChildren(...(sections.length ? sections : [h('p', { class: 'set-desc empty' }, 'Nenhuma configuração encontrada.')]),
    h('p', { class: 'set-desc json-hint' }, 'Todas as opções também ficam em ',
      h('a', { href: '#', onclick: e => { e.preventDefault(); emit('command', 'settings.openJson'); } }, 'settings.json'), '.'));
  content.scrollTop = scroll;
}

function build() {
  const root = $('#settings-view');
  const nav = h('nav', { class: 'set-nav' }, ...SECTIONS.map(sec => h('button', {
    onclick: () => { query = ''; $('#settings-search').value = ''; render(); $('#sec-' + sec.id)?.scrollIntoView({ behavior: 'smooth' }); }
  }, h('i', { class: `codicon codicon-${sec.icon}` }), sec.title)));
  root.replaceChildren(
    h('div', { class: 'set-top' },
      h('div', { class: 'input-wrap' },
        h('i', { class: 'codicon codicon-search', style: { marginLeft: '8px', opacity: '.6' } }),
        h('input', { id: 'settings-search', placeholder: 'Pesquisar configurações', spellcheck: 'false', oninput: e => { query = e.target.value.trim(); render(); } }))),
    h('div', { class: 'set-body' }, nav, h('div', { id: 'settings-content' })));
  built = true;
}

export async function showSettings() {
  if (!built) build();
  defaults = await api.invoke('settings:defaults');
  await refreshLists();
  fontLists.user = await loadUserFonts();
  render();
}

export function initSettingsUI() {
  on('settings', () => { if (built) render(); });
  on('activeTab', tab => { if (tab?.kind === 'settings') showSettings(); });
  api.on('themes:changed', async () => { if (built) { await refreshLists(); render(); } });
}
