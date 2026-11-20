const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { webUrl } = require('./navigation.cjs');

const DEFAULTS = {
  blocking: true,
  httpsFirst: true,
  doNotTrack: true,
  restoreTabs: true,
  dark: false,
  search: 'duckduckgo',
};

function preference(name, value) {
  if (!Object.hasOwn(DEFAULTS, name)) return false;
  if (name === 'search') return ['duckduckgo', 'qwant', 'google'].includes(value);
  return typeof value === 'boolean';
}

class Profile {
  constructor(directory) {
    this.file = path.join(directory, 'openweb.json');
    const initial = { settings: DEFAULTS, bookmarks: [], history: [], tabs: [], activeIndex: 0, extensions: [] };
    this.data = initial;
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.data = {
        ...initial,
        ...saved,
        settings: {
          ...DEFAULTS,
          ...Object.fromEntries(Object.entries(saved.settings ?? {}).filter(([key, value]) => preference(key, value))),
        },
        bookmarks: (saved.bookmarks ?? []).filter((entry) => webUrl(entry?.url)).slice(0, 1000),
        history: (saved.history ?? []).filter((entry) => webUrl(entry?.url)).slice(0, 300),
        tabs: (saved.tabs ?? []).map((tab) => webUrl(tab)?.href ?? '').slice(0, 40),
        extensions: (saved.extensions ?? []).filter((extension) =>
          /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(extension?.key) && typeof extension.enabled === 'boolean'),
      };
    } catch (error) {
      if (error.code !== 'ENOENT') {
        // Keep the unreadable file available for manual recovery before starting a fresh profile.
        fs.renameSync(this.file, `${this.file}.recovery-${Date.now()}`);
      }
    }
  }

  commit(changes) {
    const next = { ...this.data, ...changes };
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify(next), { mode: 0o600, flag: 'wx' });
      fs.renameSync(temporary, this.file);
      this.data = next;
    } finally {
      fs.rmSync(temporary, { force: true });
    }
  }
}

module.exports = { Profile, preference };
