# Lezx Code

IDE leve para desenvolvimento web no macOS. Construída com as mesmas peças centrais do VS Code: **Monaco** (o editor) e **xterm.js** (o terminal), rodando sobre o Electron. O sistema de extensões ficou de fora, e o que importa para web já vem embutido.

## O que vem embutido

| Recurso | Detalhes |
|---|---|
| Editor Monaco | IntelliSense de HTML/CSS/JS/TS/JSON, formatação (⇧⌥F), multi-cursor, minimapa, colorização de pares de chaves, edição ligada de tags HTML |
| Emmet | HTML, PHP, Twig, Handlebars, CSS, SCSS, Less (`!` + Tab gera o boilerplate HTML) |
| Fechamento automático de tags | Ao digitar `>` em HTML/PHP |
| Live Server | `⌥⌘L` ou "Go Live" na barra de status. Recarrega a página ao salvar; CSS é trocado **sem** recarregar |
| Terminal integrado | zsh real (node-pty), várias abas, links clicáveis (ex.: `http://localhost:5173` do Vite) |
| Explorador | Criar/renomear/duplicar/mover (arrastar)/mandar para o Lixo, menu de contexto |
| Pesquisa | Em todos os arquivos (⇧⌘F), com diferenciação de maiúsculas, palavra inteira e regex |
| Quick Open / Paleta | `⌘P` arquivos, `⇧⌘P` comandos, `:` ir para linha |
| Temas de cores e de ícones | JSON criados por você, com recarregamento ao vivo |
| Pré-visualização | Imagens, SVG, vídeo e áudio |
| Extensões de linguagem | `⇧⌘X`: C/C++ (clangd), Python (Pyright), PHP (Intelephense), JS/TS, Go, Rust, Java, Shell. Erros em tempo real, autocompletar, documentação, ir para definição (F12), renomear (F2), correções rápidas (⌘.) |
| Erros na linha, em português | A mensagem aparece no fim da linha, sem passar o mouse. As ~140 mensagens mais comuns de C, Python, PHP e JS são traduzidas, e a original fica no hover |
| Atalhos | `⌘K ⌘S` mostra todos (⌘D multi-cursor, ⌥↑/↓ mover linha, ⇧⌥↓ duplicar, ⇧⌘K apagar linha…) |
| Configurações visuais | `⌘,`: tema, fontes (interface, editor, terminal), barra lateral à esquerda/direita, cursor, salvamento automático… |
| Fontes importadas | `.ttf .otf .ttc .woff .woff2` sem instalar no macOS (Configurações > Fontes) |

## Atalhos principais

| Ação | Atalho |
|---|---|
| Paleta de comandos | ⇧⌘P |
| Ir para arquivo | ⌘P |
| Terminal | ⌃\` ou ⌘J |
| Novo terminal | ⌃⇧\` |
| Abrir arquivo ou pasta | ⌘O |
| Abrir pasta | ⇧⌘O |
| Barra lateral | ⌘B |
| Go Live / Parar | ⌥⌘L / ⌥⌘K |
| Tema de cores | ⌘K ⌘T |
| Configurações | ⌘, |
| Formatar documento | ⇧⌥F |
| Próxima/anterior aba | ⌃Tab / ⌃⇧Tab |

## Criando seus temas

As pastas ficam em `~/Library/Application Support/Lezx Code/`:

```
themes/          ← temas de cores (.json)
icon-themes/     ← temas de ícones (.json)
fonts/           ← fontes importadas
settings.json    ← configurações (também editáveis pela tela ⌘,)
state.json       ← tamanho da janela e pastas recentes
```

Elas também abrem pelo botão de paleta (🎨) na barra de atividades. Comentários `//` são aceitos. **Ao salvar o JSON, o tema é atualizado na hora.**

### Tema de cores

```jsonc
{
  "name": "Meu Tema",
  "type": "dark",
  "colors": { "editor.background": "#1e1e2e", "sideBar.background": "#181825", "focusBorder": "#cba6f7" },
  "tokens": {
    "comment": "#6c7086 italic", "string": "#a6e3a1", "keyword": "#cba6f7",
    "tag": "#f38ba8", "attribute": "#f9e2af", "property": "#94e2d5", "number": "#fab387"
  }
}
```

- `colors`: as mesmas chaves do VS Code. As que faltarem são calculadas a partir do fundo e do texto do editor.
- `tokens`: forma simples de colorir o código. Chaves: `comment string number keyword function type tag attribute property regexp delimiter variable constant operator`.
- `tokenColors`: o formato TextMate do VS Code também é aceito, então você pode colar temas existentes.

O comando **"Criar novo tema de cores"** copia o tema atual para você editar.

### Tema de ícones

```jsonc
{
  "name": "Meus Ícones",
  "iconDefinitions": {
    "js":   { "text": "JS", "color": "#f0d43a" },          // texto colorido
    "npm":  { "codicon": "package", "color": "#e8474e" },  // ícone nativo do VS Code
    "src":  { "svg": "<svg ...>...</svg>" },              // SVG embutido
    "logo": { "iconPath": "./svgs/logo.svg" }              // arquivo relativo ao JSON
  },
  "file": "…", "folder": "…", "folderExpanded": "…",
  "fileExtensions": { "js": "js" },
  "fileNames": { "package.json": "npm" },
  "folderNames": { "src": "src" },
  "folderNamesExpanded": { "src": "src" }
}
```

Lista de codicons: https://microsoft.github.io/vscode-codicons/dist/codicon.html

## Extensões de linguagem

Na aba **Extensões** (⇧⌘X), clique em **Instalar**. Se a extensão usar um servidor de linguagem:

- **clangd, gopls, rust-analyzer:** usa o que já existe no seu Mac. Se faltar, o link "instalar no terminal" roda o comando de instalação.
- **pyright, intelephense, bash-language-server:** é baixado via npm para `~/Library/Application Support/Lezx Code/servers/`, sem instalação global.

O servidor só é iniciado quando você abre um arquivo daquela linguagem.

### Criando sua extensão

Clique no **+** da aba Extensões. Ele abre `extensions/exemplo-minha-extensao.json`. Os snippets usam o mesmo formato do VS Code, então você pode colar snippets existentes:

```jsonc
{
  "name": "Minha extensão",
  "languages": ["css"],                       // ids de linguagem do editor
  "keywords": ["flex", "grid"],
  "functions": [{ "label": "rgba", "insert": "rgba(${1:0}, ${2:0}, ${3:0}, ${4:1})" }],
  "snippets": {
    "centro": { "prefix": "centro", "body": ["display: flex;", "justify-content: center;", "align-items: center;"], "description": "Centralizar com flex" }
  },
  // opcional: servidor de linguagem
  "server": { "command": "meu-servidor", "args": ["--stdio"], "npm": "pacote-npm-opcional" }
}
```

## Traduzindo mensagens de erro

As traduções embutidas ficam em `translations/pt-BR.json`. As suas ficam em `~/Library/Application Support/Lezx Code/translations/` (comando "Editar minhas traduções de erros") e têm prioridade sobre as embutidas:

```jsonc
{
  "name": "Minhas traduções",
  "rules": [
    // "match" é uma regex que casa com a mensagem inteira em inglês; $1, $2… reaproveitam os trechos (.+?)
    { "match": "Unused variable '(.+?)'", "replace": "Você criou '$1' e não usou", "lang": "c" }
  ]
}
```

## Desenvolvimento

```bash
npm install          # também corrige a permissão do spawn-helper do node-pty
npm start            # build + abre o app
npm run dist         # gera release/Lezx Code-<versão>-arm64.dmg
npm run dist:universal   # DMG para Intel + Apple Silicon
```

Estrutura:

```
main.js          processo principal: janela, menus, arquivos, terminal (node-pty), temas
live-server.js   servidor estático + recarregamento por SSE (sem dependências)
lsp.js           ponte stdio para servidores de linguagem + verificação de sintaxe Python
extensions.js    catálogo/instalação de extensões e download de servidores via npm
fonts.js         leitura de fontes (nome da família, monoespaçada) e fontes importadas
extensions/      extensões de linguagem embutidas (JSON)
preload.js       ponte segura (contextIsolation + sandbox)
build.mjs        esbuild: gera um Monaco enxuto (só linguagens úteis) + workers
src/             interface (editor, explorador, terminal, paleta, pesquisa, temas, ícones)
themes/          temas de cores embutidos
icon-themes/     temas de ícones embutidos
examples/        exemplos copiados para a pasta do usuário na primeira execução
```

### Instalação

Abra o DMG e arraste o Lezx Code para Aplicativos. O app tem assinatura ad-hoc, mas não é autenticado pela Apple. Se você baixar o DMG de outro computador, o macOS pode bloquear a primeira abertura: clique com o botão direito no app e escolha **Abrir**, ou rode `xattr -dr com.apple.quarantine "/Applications/Lezx Code.app"`.
