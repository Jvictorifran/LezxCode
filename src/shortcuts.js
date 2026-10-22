// Página "Atalhos de teclado": as teclas do editor são lidas do próprio Monaco
import { $, h, kb } from './ui.js';
import { on } from './state.js';
import { editor } from './editor.js';

// [id do comando no Monaco ou null, descrição, tecla padrão (usada se o Monaco não informar)]
const GROUPS = [
  ['Digitação e seleção', [
    ['editor.action.addSelectionToNextFindMatch', 'Selecionar a próxima ocorrência da palavra (multi-cursor)', '⌘D'],
    ['editor.action.selectHighlights', 'Selecionar todas as ocorrências', '⇧⌘L'],
    ['editor.action.moveSelectionToNextFindMatch', 'Pular a ocorrência atual e ir para a próxima', '⌘K ⌘D'],
    ['cursorUndo', 'Desfazer o último cursor', '⌘U'],
    ['editor.action.insertCursorAbove', 'Adicionar cursor acima', '⌥⌘↑'],
    ['editor.action.insertCursorBelow', 'Adicionar cursor abaixo', '⌥⌘↓'],
    [null, 'Adicionar cursor onde clicar', '⌥ + clique'],
    [null, 'Seleção em coluna (retângulo)', '⇧⌥ + arrastar'],
    ['expandLineSelection', 'Selecionar a linha inteira', '⌘L'],
    ['editor.action.smartSelect.expand', 'Expandir a seleção (palavra → expressão → bloco)', '⌃⇧⌘→'],
    ['editor.action.smartSelect.shrink', 'Reduzir a seleção', '⌃⇧⌘←']
  ]],
  ['Linhas', [
    ['editor.action.moveLinesUpAction', 'Mover linha para cima', '⌥↑'],
    ['editor.action.moveLinesDownAction', 'Mover linha para baixo', '⌥↓'],
    ['editor.action.copyLinesUpAction', 'Duplicar linha para cima', '⇧⌥↑'],
    ['editor.action.copyLinesDownAction', 'Duplicar linha para baixo', '⇧⌥↓'],
    ['editor.action.duplicateSelection', 'Duplicar seleção', '⇧⌘D'],
    ['editor.action.deleteLines', 'Apagar linha', '⇧⌘K'],
    ['editor.action.insertLineAfter', 'Nova linha abaixo (de qualquer posição)', '⌘↵'],
    ['editor.action.insertLineBefore', 'Nova linha acima', '⇧⌘↵'],
    ['editor.action.indentLines', 'Indentar', '⌘]'],
    ['editor.action.outdentLines', 'Remover indentação', '⌘['],
    ['editor.action.commentLine', 'Comentar / descomentar linha', '⌘/'],
    ['editor.action.blockComment', 'Comentário de bloco', '⇧⌥A'],
    ['editor.action.joinLines', 'Juntar linhas', '⌃J']
  ]],
  ['Autocompletar e IntelliSense', [
    [null, 'Aceitar a sugestão', 'Tab ou ↵'],
    ['editor.action.triggerSuggest', 'Mostrar sugestões', '⌃Espaço ou ⌘I'],
    ['editor.action.triggerParameterHints', 'Mostrar parâmetros da função', '⇧⌘Espaço'],
    ['editor.action.showHover', 'Mostrar documentação / erro sob o cursor', '⌘K ⌘I'],
    ['editor.action.revealDefinition', 'Ir para definição', 'F12 ou ⌘ + clique'],
    ['editor.action.rename', 'Renomear símbolo', 'F2'],
    ['editor.action.quickFix', 'Correção rápida (ex.: adicionar #include)', '⌘.'],
    ['editor.action.marker.next', 'Próximo erro', 'F8'],
    ['editor.action.marker.prev', 'Erro anterior', '⇧F8'],
    [null, 'Expandir Emmet (HTML/CSS)', 'Tab'],
    [null, 'Snippet: digite o prefixo (ex.: main, for, def) e aperte', 'Tab']
  ]],
  ['Navegação', [
    [null, 'Ir para arquivo', '⌘P'],
    [null, 'Paleta de comandos', '⇧⌘P'],
    ['editor.action.gotoLine', 'Ir para linha', '⌃G'],
    ['editor.action.jumpToBracket', 'Ir para o par de chave/parêntese', '⇧⌘\\'],
    [null, 'Próxima / anterior aba', '⌃Tab / ⌃⇧Tab'],
    ['editor.fold', 'Recolher bloco', '⌥⌘['],
    ['editor.unfold', 'Expandir bloco', '⌥⌘]'],
    ['editor.foldAll', 'Recolher tudo', '⌘K ⌘0'],
    ['editor.unfoldAll', 'Expandir tudo', '⌘K ⌘J']
  ]],
  ['Localizar', [
    [null, 'Localizar no arquivo', '⌘F'],
    [null, 'Substituir no arquivo', '⌥⌘F'],
    [null, 'Pesquisar em todos os arquivos', '⇧⌘F'],
    ['editor.action.nextMatchFindAction', 'Próximo resultado', '⌘G'],
    ['editor.action.previousMatchFindAction', 'Resultado anterior', '⇧⌘G']
  ]],
  ['Arquivos e janela', [
    [null, 'Salvar / Salvar tudo', '⌘S / ⌥⌘S'],
    [null, 'Novo arquivo', '⌘N'],
    [null, 'Abrir arquivo ou pasta', '⌘O'],
    [null, 'Abrir pasta', '⇧⌘O'],
    [null, 'Fechar aba', '⌘W'],
    [null, 'Formatar documento', '⇧⌥F'],
    [null, 'Barra lateral', '⌘B'],
    [null, 'Terminal', '⌃` ou ⌘J'],
    [null, 'Extensões', '⇧⌘X'],
    [null, 'Configurações', '⌘,'],
    [null, 'Tema de cores', '⌘K ⌘T'],
    [null, 'Go Live (Live Server)', '⌥⌘L'],
    [null, 'Quebra de linha', '⌥Z'],
    [null, 'Aumentar / diminuir fonte', '⌘= / ⌘-']
  ]],
  ['Terminal', [
    [null, 'Limpar terminal', '⌘K'],
    [null, 'Início / fim da linha', '⌘← / ⌘→'],
    [null, 'Apagar a linha', '⌘⌫'],
    [null, 'Novo terminal', '⌃⇧`']
  ]]
];

function keyFor(id, fallback) {
  if (!id) return fallback;
  try {
    const kb = editor?._standaloneKeybindingService?.lookupKeybinding(id);
    const label = kb?.getLabel();
    if (label) return label;
  } catch {}
  return kb(fallback);
}

let filter = '';
function render() {
  const view = $('#shortcuts-view');
  const q = filter.toLowerCase();
  const sections = GROUPS.map(([title, rows]) => {
    const visible = rows.filter(([, d, k]) => !q || d.toLowerCase().includes(q) || k.toLowerCase().includes(q));
    if (!visible.length) return null;
    return h('section', { class: 'kb-section' }, h('h2', {}, title),
      h('table', { class: 'kb-table' }, ...visible.map(([id, desc, def]) => h('tr', {},
        h('td', {}, desc),
        h('td', {}, ...keyFor(id, def).split(/( ou | \/ | \+ )/).map(part => /^( ou | \/ | \+ )$/.test(part) ? h('span', { class: 'kb-sep' }, part) : h('kbd', {}, part)))))));
  }).filter(Boolean);
  view.querySelector('.kb-content').replaceChildren(...sections);
}

export function initShortcuts() {
  const view = $('#shortcuts-view');
  view.append(
    h('div', { class: 'set-top' }, h('div', { class: 'input-wrap' },
      h('i', { class: 'codicon codicon-search', style: { marginLeft: '8px', opacity: '.6' } }),
      h('input', { placeholder: 'Pesquisar atalhos (ex.: linha, cursor, ⌘D)', spellcheck: 'false', oninput: e => { filter = e.target.value.trim(); render(); } }))),
    h('div', { class: 'kb-content' }));
  on('activeTab', tab => { if (tab?.kind === 'shortcuts') render(); });
}
