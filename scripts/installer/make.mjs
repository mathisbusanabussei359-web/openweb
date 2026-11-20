import { execFileSync } from 'node:child_process';
import { chmod, copyFile, cp, mkdir, mkdtemp, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../..', import.meta.url));
const { version } = require(path.join(root, 'package.json'));
const artifacts = path.join(root, 'dist', 'installers');
const arch = process.arch;
const bundle = path.join(root, 'dist', `OpenWeb-${process.platform}-${arch}`);
const executable = path.join(bundle, process.platform === 'win32' ? 'OpenWeb.exe' : 'OpenWeb');

function run(command, args) {
  execFileSync(command, args, { stdio: 'inherit' });
}

async function walk(folder, visitor, relative = '') {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const child = path.join(folder, entry.name);
    const name = path.join(relative, entry.name);
    if (entry.isDirectory()) await walk(child, visitor, name);
    await visitor(child, entry, name);
  }
}

async function windows(stage) {
  if (!existsSync(executable)) throw new Error('Exécute npm run package avant de créer le setup Windows.');
  const output = path.join(artifacts, `OpenWeb-Setup-${version}-${arch}.exe`);
  const uninstaller = path.join(stage, 'remove-files.nsh');
  const commands = [];
  await walk(bundle, (_file, entry, name) => {
    const target = name.replaceAll('$', () => '$$').replaceAll('"', '$\\"');
    if (entry.isDirectory()) commands.push(`RMDir "$INSTDIR\\${target}"`);
    else commands.push(`Delete "$INSTDIR\\${target}"`);
  });
  await writeFile(uninstaller, commands.join('\n'));
  const candidates = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles]
    .filter(Boolean).map((directory) => path.join(directory, 'NSIS', 'makensis.exe'));
  const nsis = process.env.MAKENSIS || candidates.find(existsSync) || 'makensis';
  run(nsis, [
    `/DAPP_DIR=${bundle}`, `/DOUTPUT_FILE=${output}`, `/DVERSION=${version}`,
    `/DAPP_ICON=${path.join(root, 'assets', 'openweb.ico')}`, `/DREMOVE_SCRIPT=${uninstaller}`,
    path.join(root, 'scripts', 'installer', 'windows.nsi'),
  ]);
  return output;
}

async function mac(stage) {
  const app = path.join(bundle, 'OpenWeb.app');
  if (!existsSync(app)) throw new Error('Exécute npm run package avant de créer l’image macOS.');
  const stagedApp = path.join(stage, 'OpenWeb.app');
  await chmod(stage, 0o755);
  run('ditto', [app, stagedApp]);
  run('codesign', ['--verify', '--deep', '--strict', stagedApp]);
  await symlink('/Applications', path.join(stage, 'Applications'));
  const output = path.join(artifacts, `OpenWeb-${version}-macOS-${arch}.dmg`);
  run('hdiutil', ['create', '-ov', '-srcfolder', stage, '-volname', 'OpenWeb', '-fs', 'HFS+', '-format', 'UDZO', output]);
  return output;
}

async function linux(stage) {
  if (!existsSync(executable)) throw new Error('Exécute npm run package avant de créer le paquet Linux.');
  const debArch = { x64: 'amd64', arm64: 'arm64' }[arch];
  if (!debArch) throw new Error('Architecture Debian non prise en charge.');
  const program = path.join(stage, 'opt', 'openweb');
  const control = path.join(stage, 'DEBIAN');
  const applications = path.join(stage, 'usr/share/applications');
  const icons = path.join(stage, 'usr/share/icons/hicolor/256x256/apps');
  await Promise.all([control, applications, icons, path.dirname(program)].map((dir) => mkdir(dir, { recursive: true })));
  await cp(bundle, program, { recursive: true, verbatimSymlinks: true });
  await copyFile(path.join(root, 'scripts', 'installer', 'openweb.desktop'), path.join(applications, 'openweb.desktop'));
  await copyFile(path.join(root, 'assets', 'openweb.png'), path.join(icons, 'openweb.png'));
  await writeFile(path.join(control, 'control'), [
    'Package: openweb', `Version: ${version}`, 'Section: web', 'Priority: optional',
    `Architecture: ${debArch}`, 'Maintainer: OpenWeb <299653598+mathisbusanabussei359-web@users.noreply.github.com>',
    'Depends: libgtk-3-0t64 | libgtk-3-0, libnss3, libxss1, libgbm1, libasound2t64 | libasound2, libnotify4, xdg-utils',
    'Description: Navigateur web OpenWeb', ' Navigation Chromium, filtrage réseau et coffre de mots de passe.', '',
  ].join('\n'));
  await chmod(stage, 0o755);
  await walk(stage, async (file, entry) => {
    if (entry.isSymbolicLink()) return;
    const executableBit = entry.isFile() && ((await stat(file)).mode & 0o111);
    await chmod(file, entry.isDirectory() || executableBit ? 0o755 : 0o644);
  });
  // Chromium's helper needs to be setuid root on systems that restrict user namespaces.
  await chmod(path.join(program, 'chrome-sandbox'), 0o4755);
  const output = path.join(artifacts, `openweb_${version}_${debArch}.deb`);
  run('dpkg-deb', ['--root-owner-group', '--build', stage, output]);
  return output;
}

const make = { win32: windows, darwin: mac, linux }[process.platform];
if (!make) throw new Error('Système non pris en charge.');
await mkdir(artifacts, { recursive: true });
const stage = await mkdtemp(path.join(os.tmpdir(), 'openweb-installer-'));
try {
  console.log(await make(stage));
} finally {
  await rm(stage, { recursive: true, force: true });
}
