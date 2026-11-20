const { spawnSync } = require('node:child_process');
const { copyFileSync } = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const result = spawnSync('cargo', ['build', '--locked', '--release', '--manifest-path', 'native/Cargo.toml'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, CARGO_TARGET_DIR: path.join(root, 'native', 'target') },
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

const library = {
  win32: 'openweb_native.dll',
  darwin: 'libopenweb_native.dylib',
  linux: 'libopenweb_native.so',
}[process.platform];
if (!library) throw new Error('Système non pris en charge.');
copyFileSync(path.join(root, 'native', 'target', 'release', library), path.join(root, 'app', 'openweb-native.node'));
