const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function openFirefox(query) {
  const candidates = process.platform === 'win32'
    ? [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA]
      .filter(Boolean).map((base) => path.join(base, 'Mozilla Firefox', 'firefox.exe'))
    : process.platform === 'darwin'
      ? ['/Applications', path.join(os.homedir(), 'Applications')]
        .map((base) => path.join(base, 'Firefox.app', 'Contents', 'MacOS', 'firefox'))
      : [];
  const executable = candidates.find((candidate) => fs.existsSync(candidate)) ?? 'firefox';
  return new Promise((resolve, reject) => {
    const browser = spawn(executable, ['-search', query.startsWith('-') ? ' ' + query : query], { detached: true, stdio: 'ignore', windowsHide: true });
    browser.once('error', () => reject(new Error('Firefox est introuvable. Installe-le pour utiliser son moteur de recherche.')));
    browser.once('spawn', () => {
      browser.unref();
      resolve();
    });
  });
}

module.exports = { openFirefox };
