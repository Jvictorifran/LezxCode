// O pacote node-pty vem com o spawn-helper sem permissão de execução no macOS ("posix_spawnp failed")
const fs = require('fs');
const path = require('path');
if (process.platform === 'win32') process.exit(0);
const dir = path.join(__dirname, '..', 'node_modules', 'node-pty', 'prebuilds');
if (!fs.existsSync(dir)) process.exit(0);
for (const arch of fs.readdirSync(dir)) {
  const helper = path.join(dir, arch, 'spawn-helper');
  if (fs.existsSync(helper)) fs.chmodSync(helper, 0o755);
}
