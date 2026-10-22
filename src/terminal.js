// Terminal integrado (xterm.js + node-pty no processo principal)
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { api, $, h, errorToast, makeSash, store, IS_MAC } from './ui.js';
import { state, on } from './state.js';
import { currentTheme, onThemeChange, terminalTheme } from './themes.js';

const terms = [];
let activeTerm = null;
let seq = 0;
const panel = () => $('#panel');

export const isPanelOpen = () => !panel().hidden;

function termOptions() {
  const s = state.settings;
  return {
    fontFamily: s['terminal.fontFamily'], fontSize: s['terminal.fontSize'],
    lineHeight: s['terminal.lineHeight'] || 1, cursorStyle: s['terminal.cursorStyle'] || 'block',
    theme: currentTheme() ? terminalTheme(currentTheme()) : undefined
  };
}

export async function newTerminal(cwd = state.root) {
  showPanel();
  const id = `t${++seq}`;
  const el = h('div', { class: 'term' });
  $('#terminals').append(el);
  const term = new Terminal({
    ...termOptions(), cursorBlink: true, allowProposedApi: true, macOptionIsMeta: true,
    scrollback: 5000, allowTransparency: true, drawBoldTextInBrightColors: true
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.loadAddon(new WebLinksAddon((_e, uri) => api.invoke('shell:openExternal', uri)));
  term.open(el);
  const t = { id, term, fit, el, title: 'zsh', alive: true };
  terms.push(t);
  term.attachCustomKeyEventHandler(e => {
    if (!IS_MAC) {
      // Windows: Ctrl+C copia se houver seleção (senão interrompe o comando); Ctrl+V cola
      if (e.type !== 'keydown' || !e.ctrlKey || e.altKey) return true;
      const k = e.key.toLowerCase();
      if (k === 'c' && (term.hasSelection() || e.shiftKey)) { navigator.clipboard.writeText(term.getSelection()); term.clearSelection(); e.preventDefault(); return false; }
      if (k === 'v') { e.preventDefault(); navigator.clipboard.readText().then(t => t && term.paste(t)); return false; }
      return true;
    }
    if (e.type === 'keydown' && e.metaKey && e.key === 'k') { term.clear(); return false; }
    // ⌘← / ⌘→: início/fim da linha; ⌥⌫ apaga palavra
    if (e.type === 'keydown' && e.metaKey && e.key === 'ArrowLeft') { api.send('pty:write', id, '\x01'); return false; }
    if (e.type === 'keydown' && e.metaKey && e.key === 'ArrowRight') { api.send('pty:write', id, '\x05'); return false; }
    if (e.type === 'keydown' && e.metaKey && e.key === 'Backspace') { api.send('pty:write', id, '\x15'); return false; }
    return true;
  });
  term.onData(d => api.send('pty:write', id, d));
  term.onResize(({ cols, rows }) => api.send('pty:resize', id, cols, rows));
  term.onTitleChange(title => { t.title = title.split(/[\s:]/)[0] || t.title; renderTabs(); });
  activate(t);
  try { fit.fit(); } catch {}
  try {
    const info = await api.invoke('pty:create', { id, cwd, cols: term.cols, rows: term.rows });
    t.title = info.shell;
  } catch (e) { errorToast(e); term.write('\r\n\x1b[31mNão foi possível iniciar o terminal.\x1b[0m\r\n'); }
  renderTabs();
  term.focus();
  return t;
}

// executa um comando no terminal (abre um se não houver)
export async function runInTerminal(command) {
  const t = activeTerm?.alive ? activeTerm : await newTerminal();
  showPanel();
  activate(t);
  setTimeout(() => api.send('pty:write', t.id, command + '\r'), activeTerm === t ? 0 : 600);
}

function activate(t) {
  activeTerm = t;
  for (const x of terms) x.el.style.display = x === t ? '' : 'none';
  renderTabs();
  requestAnimationFrame(() => { try { t.fit.fit(); } catch {} t.term.focus(); });
}

function renderTabs() {
  $('#term-tabs').replaceChildren(...terms.map((t, i) => h('div', {
    class: `term-tab${t === activeTerm ? ' active' : ''}`, onclick: () => activate(t)
  }, h('i', { class: 'codicon codicon-terminal' }), `${t.title}${terms.length > 1 ? ' ' + (i + 1) : ''}${t.alive ? '' : ' (encerrado)'}`)));
}

export function killTerminal(t = activeTerm) {
  if (!t) return;
  api.send('pty:kill', t.id);
  t.term.dispose();
  t.el.remove();
  terms.splice(terms.indexOf(t), 1);
  if (!terms.length) { activeTerm = null; hidePanel(); }
  else activate(terms[terms.length - 1]);
  renderTabs();
}

export function showPanel() {
  panel().hidden = false;
  $('#sash-panel').hidden = false;
  requestAnimationFrame(() => fitAll());
}
export function hidePanel() {
  panel().hidden = true;
  $('#sash-panel').hidden = true;
  document.dispatchEvent(new CustomEvent('lezx:focus-editor'));
}

export async function togglePanel() {
  if (isPanelOpen()) {
    if (activeTerm && !activeTerm.el.contains(document.activeElement)) { activeTerm.term.focus(); return; }
    hidePanel();
  } else if (!terms.length) await newTerminal();
  else { showPanel(); activeTerm?.term.focus(); }
}

function fitAll() { for (const t of terms) if (t.el.style.display !== 'none') { try { t.fit.fit(); } catch {} } }

export function initTerminal() {
  api.on('pty:data', (id, data) => terms.find(t => t.id === id)?.term.write(data));
  api.on('pty:exit', id => {
    const t = terms.find(x => x.id === id);
    if (!t) return;
    t.alive = false;
    killTerminal(t);
  });
  $('#term-new').onclick = () => newTerminal();
  $('#term-kill').onclick = () => killTerminal();
  $('#term-close').onclick = () => hidePanel();
  $('#term-max').onclick = () => {
    panel().classList.toggle('maximized');
    $('#term-max i').className = `codicon codicon-chevron-${panel().classList.contains('maximized') ? 'down' : 'up'}`;
    requestAnimationFrame(fitAll);
  };
  new ResizeObserver(() => fitAll()).observe($('#terminals'));
  panel().style.height = store.get('panelHeight', 260) + 'px';
  $('#sash-panel').hidden = true;
  makeSash($('#sash-panel'), {
    axis: 'y',
    // valor negativo: arrastar para cima aumenta o painel
    get: () => -panel().offsetHeight,
    set: v => { const max = $('#main').offsetHeight - 120; panel().style.height = Math.max(80, Math.min(max, -v)) + 'px'; },
    onEnd: () => store.set('panelHeight', panel().offsetHeight)
  });
  onThemeChange(() => { for (const t of terms) t.term.options.theme = terminalTheme(currentTheme()); });
  const applyOptions = (force = false) => {
    const o = termOptions();
    for (const t of terms) {
      // reatribuir a mesma fonte não redesenha; força quando uma fonte nova termina de carregar
      if (force) t.term.options.fontFamily = 'monospace';
      for (const k of ['fontFamily', 'fontSize', 'lineHeight', 'cursorStyle']) t.term.options[k] = o[k];
    }
    fitAll();
  };
  on('settings', () => applyOptions());
  on('fonts', () => document.fonts.ready.then(() => applyOptions(true)));
}
