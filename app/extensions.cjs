const { createHash, randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { dialog } = require('electron');

const MAX_TOTAL = 100 * 1024 * 1024;
const MAX_FILES = 10_000;

async function copyExtension(source, target, limits = { count: 0, size: 0 }, depth = 0) {
  if (depth > 30) throw new Error('Dossier d’extension trop imbriqué.');
  await fs.mkdir(target, { mode: 0o700 });
  for (const entry of await fs.readdir(source, { withFileTypes: true })) {
    if (++limits.count > MAX_FILES) throw new Error('L’extension contient trop de fichiers.');
    const input = path.join(source, entry.name);
    const output = path.join(target, entry.name);
    if (entry.isDirectory()) {
      await copyExtension(input, output, limits, depth + 1);
    } else if (entry.isFile()) {
      limits.size += (await fs.stat(input)).size;
      if (limits.size > MAX_TOTAL) throw new Error('L’extension est trop volumineuse.');
      await fs.copyFile(input, output);
    } else {
      throw new Error('Le dossier contient un lien ou un fichier spécial.');
    }
  }
}

async function readManifest(directory) {
  const file = path.join(directory, 'manifest.json');
  const info = await fs.lstat(file);
  if (!info.isFile() || info.size > 256 * 1024) throw new Error('Fichier manifest.json invalide.');
  const manifest = JSON.parse(await fs.readFile(file, 'utf8'));
  if (![2, 3].includes(manifest.manifest_version) || typeof manifest.name !== 'string'
    || typeof manifest.version !== 'string') {
    throw new Error('Le dossier doit contenir une extension Chromium valide.');
  }
  return manifest;
}

function extensionPage(extension, manifest) {
  const page = manifest.options_ui?.page ?? manifest.options_page
    ?? manifest.action?.default_popup ?? manifest.browser_action?.default_popup;
  if (typeof page !== 'string') return null;
  const root = `chrome-extension://${extension.id}/`;
  const url = new URL(page, root).href;
  return url.startsWith(root) ? url : null;
}

class Extensions {
  constructor(session, profile, directory) {
    this.api = session.extensions;
    this.profile = profile;
    this.root = path.join(directory, 'openweb-extensions');
    this.loaded = new Map();
    this.failures = new Map();
    this.busy = false;
  }

  async initialize() {
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
    for (const entry of this.profile.data.extensions) {
      if (!entry.enabled) continue;
      try {
        await this.load(entry.key);
      } catch {
        this.failures.set(entry.key, 'Chromium n’a pas pu charger cette extension.');
      }
    }
  }

  list() {
    return this.profile.data.extensions.map((entry) => ({
      ...entry,
      error: this.failures.get(entry.key),
      page: this.loaded.get(entry.key)?.page ?? null,
    }));
  }

  allows(url) {
    return [...this.loaded.values()].some(({ id }) => url.startsWith(`chrome-extension://${id}/`));
  }

  async load(key) {
    const directory = path.join(this.root, key);
    const manifest = await readManifest(directory);
    if (typeof manifest.key === 'string') {
      // Chromium encodes the first 128 bits of the public key's SHA-256 using a–p.
      const prefix = createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0, 32);
      const id = [...prefix].map((digit) => String.fromCharCode(97 + parseInt(digit, 16))).join('');
      if ([...this.loaded.values()].some((active) => active.id === id)) {
        throw new Error('Une extension avec le même identifiant est déjà active.');
      }
    }
    const extension = await this.api.loadExtension(directory, { allowFileAccess: false });
    if (path.resolve(extension.path) !== path.resolve(directory)) {
      throw new Error('Une extension avec le même identifiant est déjà active.');
    }
    let page = null;
    try {
      page = extensionPage(extension, manifest);
    } catch {
      // Chromium can still run content scripts when the optional UI URL is invalid.
    }
    this.loaded.set(key, { id: extension.id, page });
    this.failures.delete(key);
    return { name: extension.name, version: extension.version };
  }

  unload(key) {
    const active = this.loaded.get(key);
    if (active) this.api.removeExtension(active.id);
    this.loaded.delete(key);
    this.failures.delete(key);
  }

  async add(window) {
    const choice = await dialog.showOpenDialog(window, { title: 'Choisir une extension décompressée', properties: ['openDirectory'] });
    if (choice.canceled) return;
    const source = await fs.realpath(choice.filePaths[0]);
    const key = randomUUID();
    const target = path.join(this.root, key);
    const relative = path.relative(source, target);
    if (relative.split(path.sep)[0] !== '..' && !path.isAbsolute(relative)) {
      throw new Error('Choisis un dossier extérieur au profil OpenWeb.');
    }
    let saved = false;
    try {
      await copyExtension(source, target);
      const manifest = await readManifest(target);
      const permissions = [
        ...[manifest.permissions, manifest.host_permissions, manifest.optional_permissions, manifest.optional_host_permissions]
          .filter(Array.isArray).flat(),
        ...[manifest.content_scripts].filter(Array.isArray).flat()
          .flatMap((item) => Array.isArray(item?.matches) ? item.matches : []),
      ].filter((value) => typeof value === 'string');
      const listed = [...new Set(permissions)].map((value) => value.slice(0, 200));
      const review = await dialog.showMessageBox(window, {
        type: 'warning',
        title: 'Installer une extension',
        message: `Installer « ${manifest.name.slice(0, 150)} » ?`,
        detail: `Une extension peut lire ou modifier les pages auxquelles elle accède. Installe uniquement des extensions auxquelles tu fais confiance.\n\nAccès déclarés\n${listed.slice(0, 16).join(', ') || 'aucun'}${listed.length > 16 ? ` et ${listed.length - 16} autres` : ''}.`,
        buttons: ['Annuler', 'Installer'],
        defaultId: 0,
        cancelId: 0,
      });
      if (review.response !== 1) return;
      const identity = await this.load(key);
      this.profile.commit({ extensions: [...this.profile.data.extensions, { key, ...identity, enabled: true }] });
      saved = true;
    } finally {
      if (!saved) {
        this.unload(key);
        await fs.rm(target, { recursive: true, force: true }).catch(() => {});
      }
    }
  }

  async change(key, enable) {
    const current = this.profile.data.extensions.find((entry) => entry.key === key);
    if (!current) throw new Error('Extension introuvable.');
    if (enable === true && !this.loaded.has(key)) await this.load(key);
    try {
      this.profile.commit({
        extensions: enable === null
          ? this.profile.data.extensions.filter((entry) => entry !== current)
          : this.profile.data.extensions.map((entry) => entry === current ? { ...entry, enabled: enable } : entry),
      });
    } catch (error) {
      if (enable === true && !current.enabled) this.unload(key);
      throw error;
    }
    if (!enable) this.unload(key);
    if (enable === null) await fs.rm(path.join(this.root, key), { recursive: true, force: true });
  }

  async run(operation) {
    if (this.busy) throw new Error('Une opération sur les extensions est en cours.');
    this.busy = true;
    try {
      return await operation();
    } finally {
      this.busy = false;
    }
  }
}

module.exports = { Extensions };
