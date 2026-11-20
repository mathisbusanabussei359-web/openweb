const { spawnSync } = require('node:child_process');
const { statSync } = require('node:fs');
const path = require('node:path');
const electron = require('electron');

const argumentsForElectron = ['.', ...process.argv.slice(2)];
if (process.platform === 'linux') {
  const helper = process.env.CHROME_DEVEL_SANDBOX || path.join(path.dirname(electron), 'chrome-sandbox');
  const info = statSync(helper, { throwIfNoEntry: false });
  if (info?.uid !== 0 || (info.mode & 0o7777) !== 0o4755) {
    // Fall back to Chromium’s namespace sandbox if the setuid helper is unavailable.
    argumentsForElectron.unshift('--disable-setuid-sandbox');
  }
}

const child = spawnSync(electron, argumentsForElectron, {
  cwd: path.resolve(__dirname, '..'),
  stdio: 'inherit',
});
if (child.error) throw child.error;
process.exit(child.status ?? 1);
