const { randomUUID, createHash } = require('node:crypto');
const path = require('node:path');
const { clipboard } = require('electron');
const { loginOrigin } = require('./navigation.cjs');

const IDLE = 5 * 60 * 1000;
const digest = (value) => createHash('sha256').update(value).digest('hex');

class Vault {
  constructor(native, directory, changed) {
    this.native = native;
    this.path = path.join(directory, 'vault.openweb');
    this.changed = changed;
    this.active = null;
    this.generation = 0;
    this.busy = false;
    this.retryAt = 0;
    this.failures = 0;
    this.deadline = 0;
    this.clipboardDigest = null;
  }

  status() {
    if (this.active && Date.now() >= this.deadline) this.lock();
    return {
      exists: this.native.vaultExists(this.path),
      unlocked: Boolean(this.active),
      entries: this.active?.entries() ?? [],
    };
  }

  async unlock(code, confirmation) {
    if (typeof code !== 'string') throw new Error('Code maître invalide.');
    if (this.active || this.busy) throw new Error('Le coffre est déjà ouvert ou en cours d’ouverture.');
    if (Date.now() < this.retryAt) throw new Error('Patiente quelques secondes avant de réessayer.');
    const create = !this.native.vaultExists(this.path);
    if (create && code !== confirmation) throw new Error('Les deux codes doivent être identiques.');
    this.busy = true;
    const generation = this.generation;
    try {
      const session = await this.native.openVault(this.path, code, create);
      if (generation !== this.generation) {
        session.lock();
        return;
      }
      this.active = session;
      this.failures = 0;
      this.touch();
    } catch (error) {
      this.failures += 1;
      this.retryAt = Date.now() + Math.min(30_000, 500 * (2 ** this.failures));
      throw error;
    } finally {
      this.busy = false;
    }
  }

  touch() {
    clearTimeout(this.timer);
    this.deadline = Date.now() + IDLE;
    this.timer = setTimeout(() => this.lock(), IDLE).unref();
  }

  session() {
    if (this.active && Date.now() >= this.deadline) this.lock();
    if (!this.active) throw new Error('Déverrouille d’abord le coffre.');
    this.touch();
    return this.active;
  }

  put({ id, site, username, password }) {
    const session = this.session();
    if (typeof username !== 'string' || username.length > 512
      || typeof password !== 'string' || !password || password.length > 4096) {
      throw new Error('Saisis un identifiant et un mot de passe valides.');
    }
    if (id && !session.entries().some((entry) => entry.id === id)) throw new Error('Identifiant introuvable.');
    session.put(id || randomUUID(), loginOrigin(site), username, password);
  }

  get(id, origin) {
    return this.session().login(id, origin);
  }

  remove(id) {
    this.session().remove(id);
  }

  copy(id, origin) {
    const { password } = this.get(id, origin);
    clipboard.writeText(password);
    this.clipboardDigest = digest(password);
    clearTimeout(this.clipboardTimer);
    this.clipboardTimer = setTimeout(() => this.clearClipboard(), 30_000).unref();
  }

  clearClipboard() {
    clearTimeout(this.clipboardTimer);
    if (this.clipboardDigest && digest(clipboard.readText()) === this.clipboardDigest) clipboard.clear();
    this.clipboardDigest = null;
  }

  lock() {
    this.generation += 1;
    clearTimeout(this.timer);
    this.clearClipboard();
    if (this.active) {
      this.active.lock();
      this.active = null;
      this.changed();
    }
  }
}

module.exports = { Vault };
