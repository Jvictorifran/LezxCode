// Gera a fórmula (cask) do Homebrew e os manifestos do winget a partir do SHA256SUMS.txt de uma release
// Uso: node packaging/generate.mjs 1.4.0
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const version = process.argv[2];
if (!version) { console.error('uso: node packaging/generate.mjs <versão>'); process.exit(1); }
const REPO = 'Jvictorifran/LezxCode';
const root = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(root, 'out');
fs.rmSync(out, { recursive: true, force: true });

const sums = execFileSync('gh', ['release', 'download', `v${version}`, '--repo', REPO, '--pattern', 'SHA256SUMS.txt', '--output', '-'], { encoding: 'utf8' });
const sha = name => {
  const line = sums.split('\n').find(l => l.trim().endsWith('/' + name) || l.trim().endsWith(' ' + name));
  if (!line) throw new Error(`hash não encontrado para ${name}`);
  return line.split(/\s+/)[0];
};

// ---------- Homebrew ----------
const cask = `cask "lezx-code" do
  arch arm: "arm64", intel: "x64"

  version "${version}"
  sha256 arm:   "${sha(`Lezx-Code-${version}-arm64-mac.dmg`)}",
         intel: "${sha(`Lezx-Code-${version}-x64-mac.dmg`)}"

  url "https://github.com/${REPO}/releases/download/v#{version}/Lezx-Code-#{version}-#{arch}-mac.dmg"
  name "Lezx Code"
  desc "IDE leve para desenvolvimento web"
  homepage "https://github.com/${REPO}"

  livecheck do
    url :url
    strategy :github_latest
  end

  depends_on macos: ">= :monterey"

  app "Lezx Code.app"
  binary "#{appdir}/Lezx Code.app/Contents/Resources/lezx"

  # o app tem assinatura ad-hoc (sem certificado da Apple): sem isso o macOS bloqueia a primeira abertura
  postflight do
    system_command "/usr/bin/xattr", args: ["-dr", "com.apple.quarantine", "#{appdir}/Lezx Code.app"]
  end

  zap trash: [
    "~/Library/Application Support/Lezx Code",
    "~/Library/Preferences/com.lezx.code.plist",
    "~/Library/Saved Application State/com.lezx.code.savedState",
  ]
end
`;
fs.mkdirSync(path.join(out, 'homebrew', 'Casks'), { recursive: true });
fs.writeFileSync(path.join(out, 'homebrew', 'Casks', 'lezx-code.rb'), cask);

// ---------- winget ----------
const id = 'Jvictorifran.LezxCode';
const dir = path.join(out, 'winget', 'manifests', 'j', 'Jvictorifran', 'LezxCode', version);
fs.mkdirSync(dir, { recursive: true });
const head = type => `# yaml-language-server: $schema=https://aka.ms/winget-manifest.${type}.1.9.0.schema.json\n\nPackageIdentifier: ${id}\nPackageVersion: ${version}\n`;
fs.writeFileSync(path.join(dir, `${id}.yaml`), `${head('version')}DefaultLocale: en-US\nManifestType: version\nManifestVersion: 1.9.0\n`);
fs.writeFileSync(path.join(dir, `${id}.installer.yaml`), `${head('installer')}InstallerType: nullsoft
Scope: user
InstallModes:
- interactive
- silent
UpgradeBehavior: install
Installers:
- Architecture: x64
  InstallerUrl: https://github.com/${REPO}/releases/download/v${version}/Lezx-Code-${version}-x64-setup.exe
  InstallerSha256: ${sha(`Lezx-Code-${version}-x64-setup.exe`).toUpperCase()}
ManifestType: installer
ManifestVersion: 1.9.0
`);
const locale = (loc, desc, shortDesc) => `${head('defaultLocale').replace('defaultLocale', loc === 'en-US' ? 'defaultLocale' : 'locale')}PackageLocale: ${loc}
Publisher: Joao Victor Ifran
PublisherUrl: https://github.com/Jvictorifran
PackageName: Lezx Code
PackageUrl: https://github.com/${REPO}
License: MIT
LicenseUrl: https://github.com/${REPO}/blob/main/LICENSE
ShortDescription: ${shortDesc}
Description: ${desc}
Moniker: lezx-code
Tags:
- editor
- ide
- code-editor
- web-development
- monaco
ReleaseNotesUrl: https://github.com/${REPO}/releases/tag/v${version}
ManifestType: ${loc === 'en-US' ? 'defaultLocale' : 'locale'}
ManifestVersion: 1.9.0
`;
fs.writeFileSync(path.join(dir, `${id}.locale.en-US.yaml`), locale('en-US',
  'Lightweight IDE for web development built on Monaco and xterm.js: built-in Live Server, integrated terminal, JSON color and icon themes, and language extensions (clangd, Pyright, Intelephense).',
  'Lightweight IDE for web development'));
fs.writeFileSync(path.join(dir, `${id}.locale.pt-BR.yaml`), locale('pt-BR',
  'IDE leve para desenvolvimento web feita com Monaco e xterm.js: Live Server embutido, terminal integrado, temas de cores e de ícones em JSON e extensões de linguagem (clangd, Pyright, Intelephense).',
  'IDE leve para desenvolvimento web'));
console.log('gerado em', out);
for (const f of execFileSync('find', [out, '-type', 'f'], { encoding: 'utf8' }).trim().split('\n')) console.log(' ', path.relative(out, f));
