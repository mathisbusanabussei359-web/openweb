const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { SEARCH, webUrl } = require('./navigation.cjs');

const HOME_MODULES = ['quick', 'favorites', 'frequent', 'recent', 'shortcuts'];
const PRIVATE_SEARCH = ['duckduckgo', 'brave', 'startpage', 'qwant', 'bing', 'ecosia'];

const DEFAULTS = {
  blocking: true,
  httpsFirst: true,
  doNotTrack: true,
  restoreTabs: true,
  dark: false,
  search: 'duckduckgo',
  privateSearch: 'duckduckgo',
  torPort: 0,
  blockPings: true,
  thirdPartyCookies: true,
  stripTracking: true,
  httpsOnly: false,
  keepHistory: true,
  keepDownloads: true,
  animations: true,
};

function preference(name, value) {
  if (!Object.hasOwn(DEFAULTS, name)) return false;
  if (name === 'search') return typeof value === 'string' && (Object.hasOwn(SEARCH, value) || value === 'firefox');
  if (name === 'privateSearch') return PRIVATE_SEARCH.includes(value);
  if (name === 'torPort') return value === 0 || (Number.isInteger(value) && value >= 1024 && value <= 65535);
  return typeof value === 'boolean';
}

class Profile {
  constructor(directory) {
    this.file = path.join(directory, 'openweb.json');
    const initial = {
      settings: DEFAULTS, bookmarks: [], history: [], tabs: [], activeIndex: 0, extensions: [],
      homeModules: HOME_MODULES, shortcuts: [], downloads: [],
    };
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
        history: (saved.history ?? []).filter((entry) => webUrl(entry?.url)).slice(0, 300).map((entry) => ({
          ...entry, visits: Number.isSafeInteger(entry.visits) && entry.visits > 0 ? entry.visits : 1,
        })),
        homeModules: Array.isArray(saved.homeModules)
          ? [...new Set(saved.homeModules.filter((id) => HOME_MODULES.includes(id)))] : HOME_MODULES,
        shortcuts: (saved.shortcuts ?? []).filter((entry) => webUrl(entry?.url) && typeof entry.title === 'string').slice(0, 30),
        tabs: (saved.tabs ?? []).slice(0, 40).map((tab) => ({
          url: webUrl(typeof tab === 'string' ? tab : tab?.url)?.href ?? '',
          pinned: tab?.pinned === true, muted: tab?.muted === true,
        })),
        downloads: (saved.downloads ?? []).filter((entry) => entry && typeof entry.id === 'string'
          && typeof entry.name === 'string' && ['completed', 'cancelled', 'interrupted'].includes(entry.status))
          .slice(0, 100).map((entry) => ({
            id: entry.id, name: entry.name, status: entry.status, item: null,
            path: typeof entry.path === 'string' && path.isAbsolute(entry.path) ? entry.path : null,
          })),
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

module.exports = { Profile, preference, HOME_MODULES, PRIVATE_SEARCH };
