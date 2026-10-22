// Build do renderer: gera uma versão enxuta do Monaco e empacota tudo com esbuild em dist/
import * as esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';

const watch = process.argv.includes('--watch');
const ROOT = path.dirname(new URL(import.meta.url).pathname);
const MONACO = path.join(ROOT, 'node_modules/monaco-editor/esm/vs');
const DIST = path.join(ROOT, 'dist');

// Linguagens com destaque de sintaxe incluídas (o resto do Monaco fica de fora para deixar o app leve)
const LANGUAGES = [
  'html', 'css', 'scss', 'less', 'javascript', 'typescript', 'markdown', 'mdx', 'php', 'python', 'shell',
  'sql', 'mysql', 'pgsql', 'xml', 'yaml', 'ini', 'dockerfile', 'graphql', 'handlebars', 'pug', 'twig',
  'liquid', 'java', 'go', 'rust', 'ruby', 'cpp', 'csharp', 'kotlin', 'swift', 'lua', 'bat', 'powershell'
];

function generateMonacoEntry() {
  const main = fs.readFileSync(path.join(MONACO, 'editor/editor.main.js'), 'utf8');
  const lines = main.split('\n').filter(l => {
    if (l.includes('monaco-lsp-client') || l.includes('as lsp')) return false;
    const m = l.match(/languages\/definitions\/([^/]+)\/register\.js/);
    if (m) return LANGUAGES.includes(m[1]);
    return true;
  });
  // caminhos absolutos: o campo "exports" do pacote monaco-editor não permite importar esm/ diretamente
  const fixed = lines.map(l => l.replace(/(from |import )'(\.\.?\/[^']+)'/g, (_, kw, rel) => `${kw}${JSON.stringify(path.join(MONACO, 'editor', rel))}`));
  fs.mkdirSync(path.join(ROOT, 'src/gen'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'src/gen/monaco-lite.js'), '// Gerado por build.mjs — não editar\n' + fixed.join('\n'));
}

generateMonacoEntry();
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });
fs.copyFileSync(path.join(ROOT, 'src/index.html'), path.join(DIST, 'index.html'));

const common = {
  bundle: true,
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  target: 'chrome130',
  logLevel: 'info',
  legalComments: 'none',
  define: { 'process.env.NODE_ENV': '"production"' },
  loader: { '.ttf': 'file', '.woff': 'file', '.woff2': 'file', '.svg': 'file', '.png': 'file' }
};

const workers = {
  'editor.worker': `${MONACO}/editor/editor.worker.js`,
  'json.worker': `${MONACO}/language/json/json.worker.js`,
  'css.worker': `${MONACO}/language/css/css.worker.js`,
  'html.worker': `${MONACO}/language/html/html.worker.js`,
  'ts.worker': `${MONACO}/language/typescript/ts.worker.js`
};

const builds = [
  { ...common, entryPoints: { renderer: path.join(ROOT, 'src/main.js') }, outdir: DIST, format: 'esm', splitting: true, chunkNames: 'chunks/[name]-[hash]', assetNames: 'assets/[name]-[hash]' },
  { ...common, entryPoints: workers, outdir: path.join(DIST, 'workers'), format: 'iife' }
];

if (watch) {
  for (const b of builds) (await esbuild.context(b)).watch();
} else {
  await Promise.all(builds.map(b => esbuild.build(b)));
  // o esbuild duplica o CSS do Monaco em cada chunk carregado sob demanda; tudo já está em renderer.css
  for (const f of fs.readdirSync(path.join(DIST, 'chunks'))) if (f.endsWith('.css')) fs.rmSync(path.join(DIST, 'chunks', f));
}
