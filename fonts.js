// Fontes: leitura do nome da família direto do arquivo (sfnt), lista do sistema e fontes importadas
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');

const FONT_EXT = /\.(ttf|otf|ttc|woff2?)$/i;
const WEIGHTS = [['thin', 100], ['hairline', 100], ['extralight', 200], ['ultralight', 200], ['light', 300], ['regular', 400], ['book', 400],
  ['medium', 500], ['semibold', 600], ['demibold', 600], ['extrabold', 800], ['ultrabold', 800], ['bold', 700], ['black', 900], ['heavy', 900]];

async function readAt(fh, pos, len) {
  const buf = Buffer.alloc(len);
  const { bytesRead } = await fh.read(buf, 0, len, pos);
  return buf.subarray(0, bytesRead);
}

function decodeName(buf, platform) {
  if (platform === 3 || platform === 0) {
    let s = '';
    for (let i = 0; i + 1 < buf.length; i += 2) s += String.fromCharCode(buf.readUInt16BE(i));
    return s;
  }
  return buf.toString('latin1');
}

// Lê família, peso, itálico e se é monoespaçada lendo só as tabelas necessárias
async function readFontInfo(file) {
  const fh = await fsp.open(file, 'r');
  try {
    let base = 0;
    const head = await readAt(fh, 0, 12);
    if (head.length < 12) return null;
    const tag = head.toString('latin1', 0, 4);
    if (tag === 'wOFF' || tag === 'wOF2') return null; // comprimidas: usa o nome do arquivo
    if (tag === 'ttcf') base = (await readAt(fh, 12, 4)).readUInt32BE(0);
    const offTable = await readAt(fh, base, 12);
    const numTables = offTable.readUInt16BE(4);
    if (!numTables || numTables > 100) return null;
    const dir = await readAt(fh, base + 12, numTables * 16);
    const tables = {};
    for (let i = 0; i < numTables; i++) {
      const t = dir.toString('latin1', i * 16, i * 16 + 4);
      tables[t] = { offset: dir.readUInt32BE(i * 16 + 8), length: dir.readUInt32BE(i * 16 + 12) };
    }
    if (!tables.name) return null;
    const name = await readAt(fh, tables.name.offset, Math.min(tables.name.length, 256 * 1024));
    const count = name.readUInt16BE(2), strOff = name.readUInt16BE(4);
    const names = {};
    for (let i = 0; i < count; i++) {
      const r = 6 + i * 12;
      if (r + 12 > name.length) break;
      const platform = name.readUInt16BE(r), lang = name.readUInt16BE(r + 4), id = name.readUInt16BE(r + 6);
      const len = name.readUInt16BE(r + 8), off = name.readUInt16BE(r + 10);
      if (![1, 2, 16, 17].includes(id)) continue;
      const english = platform === 3 ? lang === 0x409 : platform === 1 ? lang === 0 : true;
      const prio = (platform === 3 ? 3 : platform === 0 ? 2 : 1) + (english ? 10 : 0);
      if (names[id] && names[id].prio >= prio) continue;
      const start = strOff + off;
      if (start + len > name.length) continue;
      names[id] = { prio, value: decodeName(name.subarray(start, start + len), platform).replace(/\0/g, '').trim() };
    }
    const family = names[16]?.value || names[1]?.value;
    if (!family || family.startsWith('.')) return null; // fontes internas do macOS (.SF etc.)
    let weight = 400, italic = false, mono = false;
    if (tables['OS/2']) {
      const os2 = await readAt(fh, tables['OS/2'].offset, 64);
      if (os2.length >= 64) { weight = os2.readUInt16BE(4) || 400; italic = !!(os2.readUInt16BE(62) & 1); }
    }
    if (tables.post) {
      const post = await readAt(fh, tables.post.offset, 16);
      if (post.length >= 16) mono = post.readUInt32BE(12) !== 0;
    }
    const sub = (names[17]?.value || names[2]?.value || '').toLowerCase();
    if (/italic|oblique/.test(sub)) italic = true;
    return { family, weight, italic, mono };
  } catch { return null; }
  finally { await fh.close(); }
}

function infoFromFilename(file) {
  const base = path.basename(file).replace(FONT_EXT, '');
  const lower = base.toLowerCase().replace(/[-_ ]/g, '');
  let weight = 400;
  for (const [k, w] of WEIGHTS) if (lower.endsWith(k) || lower.includes(k + 'italic')) { weight = w; break; }
  const italic = /italic|oblique/i.test(base);
  const family = base.replace(/[-_ ]?(thin|hairline|extra ?light|ultra ?light|light|regular|book|medium|semi ?bold|demi ?bold|extra ?bold|ultra ?bold|bold|black|heavy)?[-_ ]?(italic|oblique)?$/i, '').replace(/([a-z])([A-Z])/g, '$1 $2').trim() || base;
  return { family, weight, italic, mono: /mono|code|consol|courier/i.test(base) };
}

async function describe(file) {
  return { file, ...((await readFontInfo(file)) || infoFromFilename(file)) };
}

// ---------- fontes importadas ----------
function createFontStore(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return {
    dir,
    async list() {
      const files = (await fsp.readdir(dir)).filter(f => FONT_EXT.test(f)).sort();
      const out = [];
      for (const f of files) out.push({ ...(await describe(path.join(dir, f))), name: f, url: `lezx://fonts/${encodeURIComponent(f)}` });
      return out;
    },
    async import(paths) {
      const added = [];
      for (const p of paths) {
        if (!FONT_EXT.test(p)) continue;
        const target = path.join(dir, path.basename(p));
        await fsp.copyFile(p, target);
        added.push(path.basename(p));
      }
      return added;
    },
    async remove(name) {
      const target = path.join(dir, path.basename(name));
      if (target.startsWith(dir)) await fsp.rm(target, { force: true });
    }
  };
}

// ---------- fontes do sistema ----------
let systemCache = null;
async function systemFonts() {
  if (systemCache) return systemCache;
  const dirs = ['/System/Library/Fonts', '/System/Library/Fonts/Supplemental', '/Library/Fonts', path.join(os.homedir(), 'Library/Fonts')];
  const families = new Map();
  for (const d of dirs) {
    let files = [];
    try { files = (await fsp.readdir(d)).filter(f => FONT_EXT.test(f)); } catch { continue; }
    await Promise.all(files.map(async f => {
      const info = await describe(path.join(d, f));
      if (!info?.family) return;
      const cur = families.get(info.family);
      families.set(info.family, { family: info.family, mono: (cur?.mono || false) || info.mono });
    }));
  }
  systemCache = [...families.values()].sort((a, b) => a.family.localeCompare(b.family));
  return systemCache;
}

module.exports = { createFontStore, systemFonts, FONT_EXT };
