import path from 'node:path';
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
  ignore: /^\/(?:\.git(?:hub)?|dist|native|scripts|tests|node_modules)(?:\/|$)/,
});
console.log(output.join('\n'));
