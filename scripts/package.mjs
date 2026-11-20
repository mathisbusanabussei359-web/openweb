import path from 'node:path';
import { chmod, copyFile, rename } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { packager } from '@electron/packager';

const require = createRequire(import.meta.url);
const dir = fileURLToPath(new URL('..', import.meta.url));
const output = await packager({
  dir,
  name: 'OpenWeb',
  out: path.join(dir, 'dist'),
  overwrite: true,
  download: { checksums: require('electron/checksums.json') },
  asar: { unpack: '**/*.node' },
  ignore: /^\/(?:\.git(?:hub)?|dist|native|scripts|tests)(?:\/|$)/,
});
if (process.platform === 'linux') {
  for (const directory of output) {
    const launcher = path.join(directory, 'OpenWeb');
    await rename(launcher, path.join(directory, 'openweb-bin'));
    await copyFile(new URL('./linux-launcher.sh', import.meta.url), launcher);
    await chmod(launcher, 0o755);
  }
}
console.log(output.join('\n'));
