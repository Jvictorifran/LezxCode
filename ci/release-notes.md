IDE leve para desenvolvimento web, construída com as mesmas peças centrais do VS Code (Monaco + xterm.js).

## Instalação

**macOS (Homebrew)**
```bash
brew install --cask jvictorifran/tap/lezx-code
```

**macOS / Windows (npm)** — instala o app e o comando `lezx`
```bash
npm install -g lezx-code
lezx .
```

**Download direto**

| Sistema | Arquivo |
|---|---|
| Mac com chip Apple (M1–M4) | `Lezx-Code-<versão>-arm64-mac.dmg` |
| Mac Intel | `Lezx-Code-<versão>-x64-mac.dmg` |
| Windows 10/11 (64 bits) | `Lezx-Code-<versão>-x64-setup.exe` |

Os instaladores não são assinados por certificado pago. Por isso:
- **macOS:** se o app for bloqueado, clique com o botão direito → **Abrir**, ou rode `xattr -dr com.apple.quarantine "/Applications/Lezx Code.app"`. Pelo Homebrew isso já é feito automaticamente.
- **Windows:** se o SmartScreen avisar, clique em **Mais informações → Executar assim mesmo**.

## Destaques

- **Novo:** versão para Windows (terminal com PowerShell, atalhos com Ctrl)
- **Novo:** comando `lezx` para abrir pastas pelo terminal (`lezx .`)
- Live Server embutido, com recarregamento automático
- Terminal integrado
- Extensões de linguagem: C/C++ (clangd), Python (Pyright), PHP (Intelephense), JS/TS, Go, Rust, Java e Shell
- Erros escritos na própria linha e traduzidos para português
- Temas de cores e de ícones criados em JSON
- Medido num Mac: 62% menos RAM e 66% menor que o VS Code 1.143

`SHA256SUMS.txt` traz os hashes de todos os arquivos.
