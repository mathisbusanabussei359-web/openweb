const {
  app, BrowserWindow, WebContentsView, Menu, session, ipcMain, powerMonitor, dialog, shell, clipboard,
} = require('electron');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const native = require('./openweb-native.node');
const { Profile, preference, HOME_MODULES } = require('./profile.cjs');
const { Privacy } = require('./privacy.cjs');
const { Extensions } = require('./extensions.cjs');
const { Vault } = require('./vault.cjs');
const { connectTor } = require('./tor.cjs');
const { STORE, storeId } = require('./webstore.cjs');
const { openFirefox } = require('./firefox.cjs');
const { stripTracking } = require('./privacy-rules.cjs');
const { address, webUrl, isolated, fillLogin, extractArticle } = require('./navigation.cjs');

const CHROME_HEIGHT = 106;
const MAX_TABS = 40;
const HOME = path.join(__dirname, '../ui/index.html');
const HOME_URL = pathToFileURL(HOME).href;
const browsers = new Map();
const guests = new Map();
const webPreferences = {
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  webviewTag: false,
  webSecurity: true,
  allowRunningInsecureContent: false,
  navigateOnDragDrop: false,
  devTools: false,
  spellcheck: false,
};

let profile;
let privacy;
let persistent;
let extensions;
let vault;
let regular;

app.enableSandbox();
for (const flag of [
  'site-per-process', 'disable-background-networking', 'disable-sync', 'disable-domain-reliability',
  'disable-breakpad', 'disable-quic', 'disable-preconnect', 'dns-prefetch-disable',
]) app.commandLine.appendSwitch(flag);
app.commandLine.appendSwitch('force-webrtc-ip-handling-policy', 'disable_non_proxied_udp');
app.commandLine.appendSwitch('disable-features',
  'OptimizationHints,MediaRouter,AutofillServerCommunication,NetworkTimeServiceQuerying,UseDnsHttpsSvcb');
app.on('session-created', (context) => {
  context.setSpellCheckerEnabled(false);
  if (process.platform !== 'darwin') context.setSpellCheckerLanguages([]);
});

function mainFrameGuard(target, event) {
  const url = event.url;
  if (webUrl(url)) return;
  if (target.extension && extensions.allows(url) && url.startsWith(target.extension)) return;
  if (!event.isMainFrame && /^(about:(?:blank|srcdoc)$|data:|blob:)/.test(url)) return;
  event.preventDefault();
}

function setupSession(context) {
  privacy.configure(context, () => profile.data.settings, (id) => guests.get(id));
  context.setUserAgent(context.getUserAgent().replace(/\s+(?:Electron|OpenWeb)\/[^\s]+/gi, ''));
  context.on('will-download', (event, item, contents) => {
    const tab = guests.get(contents?.id);
    if (!tab || tab.browser.downloading) return event.preventDefault();
    tab.browser.download(item);
  });
}

class Tab {
  constructor(browser, url, identifier = randomUUID()) {
    this.browser = browser;
    this.id = identifier;
    this.url = '';
    this.pending = url;
    this.title = '';
    this.blocked = 0;
    this.error = '';
    this.loading = false;
    this.view = null;
    this.extension = null;
  }

  start() {
    if (this.view || !this.pending || !this.browser.canBrowse()) return;
    this.createView();
    this.load(this.pending);
  }

  createView() {
    const tab = this;
    this.view = new WebContentsView({ webPreferences: { ...webPreferences, session: this.browser.session } });
    const contents = this.view.webContents;
    contents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
    const contentsId = contents.id;
    guests.set(contentsId, this);
    contents.once('destroyed', () => guests.delete(contentsId));
    contents.on('will-frame-navigate', (event) => mainFrameGuard(this, event));
    contents.on('will-redirect', (event) => {
      mainFrameGuard(this, event);
      if (event.isMainFrame && webUrl(event.url)) this.pending = event.url;
    });
    contents.on('will-attach-webview', (event) => event.preventDefault());
    contents.setWindowOpenHandler(({ url, disposition, postBody }) => {
      if (webUrl(url) && !postBody && ['foreground-tab', 'background-tab', 'new-window'].includes(disposition)
        && Date.now() - (this.lastPopup ?? 0) > 900
        && this.browser.tabs.length < MAX_TABS) {
        this.lastPopup = Date.now();
        setImmediate(() => {
          if (!this.browser.closed && this.browser.tabs.length < MAX_TABS) {
            this.browser.newTab(url, disposition !== 'background-tab');
          }
        });
      }
      return { action: 'deny' };
    });
    contents.on('did-start-navigation', (event) => {
      if (!event.isMainFrame || event.isSameDocument) return;
      this.pending = event.url;
      this.error = '';
      this.blocked = 0;
      this.browser.render();
    });
    contents.on('did-start-loading', () => {
      this.loading = true;
      this.browser.publish();
    });
    contents.on('did-stop-loading', () => {
      this.loading = false;
      if (this.url && !this.error) this.pending = '';
      this.browser.render();
    });
    contents.on('did-navigate', (_event, url) => this.committed(url));
    contents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
      if (isMainFrame) this.committed(url);
    });
    contents.on('page-title-updated', (_event, title) => {
      this.title = title.slice(0, 240);
      this.browser.visit(this, false);
      this.browser.publish();
    });
    contents.on('did-fail-load', (_event, code, reason, url, isMainFrame) => {
      if (isMainFrame && code !== -3 && url === this.pending) this.fail(reason);
    });
    contents.on('render-process-gone', () => this.fail('Le processus de cette page s’est arrêté.'));
    contents.on('before-input-event', (event, input) => this.browser.shortcut(event, input));
    contents.on('context-menu', (_event, params) => {
      const link = webUrl(params.linkURL)?.href;
      const items = [];
      if (link) {
        items.push({ label: 'Ouvrir dans un nouvel onglet', enabled: this.browser.tabs.length < MAX_TABS, click: () => this.browser.newTab(link, false) });
        items.push({ label: 'Copier l’adresse du lien', click: () => clipboard.writeText(link) });
      }
      if (params.isEditable) items.push({ label: 'Couper', click: () => contents.cut() });
      if (params.selectionText || params.isEditable) items.push({ label: 'Copier', click: () => contents.copy() });
      if (params.isEditable) items.push({ label: 'Coller', click: () => contents.paste() });
      if (!items.length) items.push({ label: 'Recharger', click: () => tab.reload() });
      Menu.buildFromTemplate(items).popup({ window: this.browser.window });
    });
  }

  load(url) {
    if (!this.browser.canBrowse()) return;
    if (!webUrl(url) && !(this.extension && url.startsWith(this.extension) && extensions.allows(url))) return;
    if (!this.view) this.createView();
    this.pending = url;
    this.error = '';
    this.browser.render();
    void this.view.webContents.loadURL(url).catch((error) => {
      if (!this.browser.closed && this.view && this.pending === url && !this.error && error.code !== 'ERR_ABORTED') {
        this.fail('Impossible de charger cette adresse.');
      }
    });
  }

  committed(url) {
    if (!webUrl(url) && !(this.extension && url.startsWith(this.extension) && extensions.allows(url))) return;
    if (this.url !== url) this.title = '';
    this.url = url;
    this.pending = '';
    this.error = '';
    this.browser.visit(this, true);
    this.browser.saveSoon();
    this.browser.render();
  }

  reload() {
    this.browser.requireConnection();
    const url = this.pending || this.url;
    if (!url) return;
    if (this.error || !this.view) this.load(url);
    else this.view.webContents.reload();
  }

  fail(reason) {
    if (this.browser.privateMode && /^ERR_(?:SOCKS|PROXY|TUNNEL)_/.test(reason)) {
      this.browser.torStatus = 'offline';
      this.browser.torMessage = 'Connexion Tor interrompue. Vérifie Tor, puis réessaie.';
    }
    this.error = reason;
    this.loading = false;
    this.browser.render();
  }

  countBlocked() {
    this.blocked += 1;
    this.browser.publishSoon();
  }

  close() {
    const view = this.view;
    this.view = null;
    if (view) {
      if (this.browser.attached === view) this.browser.detach();
      if (!view.webContents.isDestroyed()) view.webContents.close({ waitForBeforeUnload: false });
    }
  }

  summary() {
    const navigation = this.view?.webContents.navigationHistory;
    return {
      id: this.id,
      title: this.title || webUrl(this.url || this.pending)?.hostname || (this.extension ? 'Extension' : 'Nouvel onglet'),
      url: this.error ? (this.pending || this.url) : (this.url || this.pending),
      error: this.error,
      home: !this.url && !this.pending,
      committed: Boolean(this.url && !this.error),
      loading: this.loading,
      blocked: this.blocked,
      zoom: this.view?.webContents.getZoomFactor() ?? 1,
      back: navigation?.canGoToOffset(-1) ?? false,
      forward: navigation?.canGoToOffset(1) ?? false,
    };
  }
}

class Browser {
  constructor(privateMode = false) {
    this.privateMode = privateMode;
    this.session = privateMode ? session.fromPartition(`private:${randomUUID()}`) : persistent;
    this.torStatus = privateMode ? 'checking' : null;
    this.torMessage = '';
    this.torPort = profile.data.settings.torPort;
    if (privateMode) setupSession(this.session);
    this.tabs = [];
    this.closedTabs = [];
    this.downloads = [];
    this.history = privateMode ? [] : [...profile.data.history];
    this.panel = null;
    this.attached = null;
    this.reader = null;
    this.closed = false;
    this.window = new BrowserWindow({
      width: 1200,
      height: 850,
      minWidth: 620,
      minHeight: 440,
      title: privateMode ? 'OpenWeb · Navigation privée' : 'OpenWeb',
      backgroundColor: '#16182b',
      autoHideMenuBar: true,
      webPreferences: {
        ...webPreferences,
        partition: 'openweb-chrome',
        preload: path.join(__dirname, 'preload.cjs'),
        spellcheck: false,
      },
    });

    const chrome = this.window.webContents;
    const chromeId = chrome.id;
    browsers.set(chromeId, this);
    const deny = (event) => event.preventDefault();
    for (const event of ['will-frame-navigate', 'will-redirect', 'will-attach-webview']) chrome.on(event, deny);
    chrome.setWindowOpenHandler(() => ({ action: 'deny' }));
    chrome.on('before-input-event', (event, input) => this.shortcut(event, input));
    this.window.on('resize', () => this.resize());
    this.window.on('close', () => {
      this.save();
      if (!this.privateMode) vault.lock();
    });
    this.window.on('closed', () => {
      this.closed = true;
      clearTimeout(this.publishTimer);
      for (const tab of this.tabs) tab.close();
      browsers.delete(chromeId);
      if (this.privateMode) void this.session.clearData().catch(() => {});
      else regular = null;
    });

    const saved = privateMode || !profile.data.settings.restoreTabs ? [] : profile.data.tabs;
    this.tabs = (saved.length ? saved : ['']).map((url) => new Tab(this, url));
    const selected = Number.isInteger(profile.data.activeIndex) ? profile.data.activeIndex : 0;
    this.active = this.tabs[Math.min(Math.max(selected, 0), this.tabs.length - 1)];
    this.active.start();
    void this.window.loadFile(HOME);
    if (privateMode) void this.checkTor();
  }

  canBrowse() {
    return !this.privateMode || this.torStatus === 'ready';
  }

  requireConnection() {
    if (!this.canBrowse()) throw new Error('La navigation privée attend une connexion Tor vérifiée.');
  }

  async checkTor() {
    if (this.checkingTor || this.torStatus === 'ready') return;
    this.checkingTor = true;
    this.torStatus = 'checking';
    this.torMessage = '';
    this.publish();
    try {
      const ports = this.torPort ? [this.torPort] : [9050, 9150];
      for (const port of ports) {
        try {
          await connectTor(this.session, port);
          this.torStatus = 'ready';
          this.torMessage = `Connexion Tor vérifiée · port ${port}`;
          return;
        } catch (error) {
          this.torMessage = error.message;
        }
      }
      this.torStatus = 'offline';
      if (!this.torPort) this.torMessage = 'Démarre Tor ou le Navigateur Tor sur le port 9050 ou 9150.';
    } finally {
      this.checkingTor = false;
      this.publish();
    }
  }

  newTab(url = '', activate = true) {
    if (this.tabs.length >= MAX_TABS) throw new Error('La limite de 40 onglets est atteinte.');
    const tab = new Tab(this, url);
    this.tabs.push(tab);
    if (activate) this.select(tab.id);
    else tab.start();
    this.saveSoon();
    this.publish();
    return tab;
  }

  select(id) {
    const tab = this.tabs.find((candidate) => candidate.id === id);
    if (!tab) return;
    this.active = tab;
    this.panel = null;
    this.reader = null;
    tab.start();
    this.render();
    this.saveSoon();
  }

  closeTab(id) {
    const index = this.tabs.findIndex((tab) => tab.id === id);
    if (index < 0) return;
    const [tab] = this.tabs.splice(index, 1);
    const url = webUrl(tab.url || tab.pending)?.href;
    if (url) {
      this.closedTabs.unshift(url);
      this.closedTabs.length = Math.min(this.closedTabs.length, 20);
    }
    tab.close();
    if (this.active === tab) {
      if (!this.tabs.length) this.tabs.push(new Tab(this, ''));
      this.select(this.tabs[Math.min(index, this.tabs.length - 1)].id);
    }
    this.render();
    this.saveSoon();
  }

  detach() {
    if (!this.attached) return;
    if (!this.window.isDestroyed()) this.window.contentView.removeChildView(this.attached);
    this.attached = null;
  }

  resize() {
    if (!this.attached || this.window.isDestroyed()) return;
    const { width, height } = this.window.getContentBounds();
    this.attached.setBounds({ x: 0, y: CHROME_HEIGHT, width, height: Math.max(0, height - CHROME_HEIGHT) });
  }

  render() {
    if (this.closed || this.window.isDestroyed()) return;
    const tab = this.active;
    const next = this.canBrowse() && !this.panel && tab?.url && !tab.error ? tab.view : null;
    if (next !== this.attached) {
      this.detach();
      if (next) {
        this.window.contentView.addChildView(next);
        this.attached = next;
        this.resize();
      }
    }
    this.publish();
  }

  publish() {
    if (!this.closed && !this.window.webContents.isDestroyed()) {
      this.window.webContents.send('openweb:changed', this.state());
    }
  }

  publishSoon() {
    if (this.publishTimer) return;
    this.publishTimer = setTimeout(() => {
      this.publishTimer = null;
      this.publish();
    }, 150).unref();
  }

  state() {
    const current = this.active?.summary();
    const home = !this.privateMode && current?.home && !this.panel;
    const homeEdit = this.panel === 'home';
    const display = profile.data.homeModules;
    return {
      privateMode: this.privateMode,
      torStatus: this.torStatus,
      torMessage: this.torMessage,
      searchChoice: this.privateMode ? profile.data.settings.privateSearch : profile.data.settings.search,
      homeModules: home || homeEdit ? display : [],
      shortcuts: homeEdit ? profile.data.shortcuts : home && display.includes('shortcuts') ? profile.data.shortcuts.slice(0, 8) : [],
      frequent: home && display.includes('frequent') ? this.frequent() : [],
      recent: home && display.includes('recent') ? this.history.slice(0, 6) : [],
      storeListing: this.privateMode || !current?.committed ? null : storeId(current.url),
      tabs: this.tabs.map((tab) => tab.summary()),
      active: current,
      panel: this.panel,
      dark: profile.data.settings.dark,
      marked: !this.privateMode && profile.data.bookmarks.some((entry) => entry.url === this.active?.url),
      bookmarks: this.panel === 'bookmarks' ? profile.data.bookmarks : home && display.includes('favorites') ? profile.data.bookmarks.slice(0, 8) : [],
      history: this.panel === 'history' ? this.history : [],
      settings: this.panel === 'settings' ? profile.data.settings : null,
      filterStatus: privacy.status,
      blocking: profile.data.settings.blocking,
      downloads: this.panel === 'downloads' ? this.downloads.map(({ item, ...download }) => download) : [],
      extensions: this.panel === 'extensions' ? extensions.list() : [],
      vault: this.panel === 'vault' ? vault.status() : null,
      reader: this.panel === 'reader' ? this.reader : null,
    };
  }

  visit(tab, counted) {
    const url = webUrl(tab.url);
    if (this.privateMode || !profile.data.settings.keepHistory || !url || tab.url.length > 8192 || tab.error) return;
    const previous = this.history.find((entry) => entry.url === tab.url);
    if (counted) {
      this.history = [{
        url: tab.url, title: previous?.title || url.hostname, date: Date.now(), visits: (previous?.visits ?? 0) + 1,
      }, ...this.history.filter((entry) => entry !== previous)].slice(0, 300);
    } else if (previous && tab.title) previous.title = tab.title;
    this.saveSoon();
  }

  frequent() {
    const sites = new Map();
    for (const entry of this.history) {
      const url = webUrl(entry.url);
      if (!url) continue;
      const item = sites.get(url.origin) ?? { title: url.hostname, url: url.origin + '/', visits: 0 };
      item.visits += entry.visits ?? 1;
      sites.set(url.origin, item);
    }
    return [...sites.values()].sort((a, b) => b.visits - a.visits).slice(0, 6);
  }

  saveSoon() {
    if (!this.privateMode && !this.saveTimer) this.saveTimer = setTimeout(() => this.save(), 400).unref();
  }

  save() {
    if (this.privateMode || this.closed) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    try {
      const keep = profile.data.settings.restoreTabs;
      profile.commit({
        history: this.history,
        tabs: keep ? this.tabs.map((tab) => {
          const url = webUrl(tab.url || tab.pending)?.href ?? '';
          return url.length <= 8192 ? url : '';
        }) : [],
        activeIndex: keep ? this.tabs.indexOf(this.active) : 0,
      });
    } catch {
      this.notify('Impossible d’enregistrer l’état de navigation sur le disque.');
    }
  }

  notify(message) {
    if (!this.closed && !this.window.webContents.isDestroyed()) this.window.webContents.send('openweb:notice', message);
  }

  download(item) {
    this.downloading = true;
    const record = { id: randomUUID(), name: item.getFilename(), received: 0, total: item.getTotalBytes(), status: 'progress', item };
    this.downloads.unshift(record);
    if (this.downloads.length > 100) this.downloads.pop();
    item.setSaveDialogOptions({ title: 'Enregistrer le téléchargement', nameFieldLabel: 'Nom du fichier' });
    this.publish();
    item.on('updated', (_event, state) => {
      record.received = item.getReceivedBytes();
      record.total = item.getTotalBytes();
      record.status = state;
      this.publishSoon();
    });
    item.once('done', (_event, state) => {
      this.downloading = false;
      record.item = null;
      record.path = state === 'completed' ? item.getSavePath() : null;
      record.received = item.getReceivedBytes();
      record.status = state;
      this.publish();
    });
  }

  focusAddress() {
    this.window.webContents.focus();
    this.window.webContents.send('openweb:address');
  }

  navigate(url) {
    this.requireConnection();
    if (profile.data.settings.httpsOnly && url.startsWith('http:')) {
      throw new Error('Le mode HTTPS uniquement bloque cette adresse.');
    }
    if (profile.data.settings.stripTracking) url = stripTracking(url);
    this.panel = null;
    this.reader = null;
    if (this.active.extension) this.newTab(url);
    else this.active.load(url);
  }

  moveHistory(offset) {
    this.requireConnection();
    const navigation = this.active.view?.webContents.navigationHistory;
    if (!navigation?.canGoToOffset(offset)) return;
    this.panel = null;
    navigation.goToOffset(offset);
    this.render();
  }

  zoom(change) {
    if (!this.active.view) return;
    const contents = this.active.view.webContents;
    const factor = change ? Math.min(3, Math.max(0.5, contents.getZoomFactor() + change)) : 1;
    contents.setZoomFactor(factor);
    this.publish();
  }

  shortcut(event, input) {
    if (input.type !== 'keyDown') return;
    const command = process.platform === 'darwin' ? input.meta : input.control;
    const key = input.key.toLowerCase();
    let action;
    if (command && !input.alt) {
      if (key === 'l') action = () => this.focusAddress();
      if (key === 't') action = () => {
        const url = input.shift ? this.closedTabs[0] : '';
        if (url === undefined) return;
        this.newTab(url);
        if (input.shift) this.closedTabs.shift();
        else this.focusAddress();
      };
      if (key === 'n' && input.shift) action = () => new Browser(true);
      if (key === 'w') action = () => this.tabs.length === 1 ? this.window.close() : this.closeTab(this.active.id);
      if (key === 'r') action = () => this.active.reload();
      if (['=', '+', '-', '0'].includes(key)) action = () => this.zoom(key === '0' ? 0 : key === '-' ? -0.1 : 0.1);
      if (/^[1-9]$/.test(key)) action = () => this.select((key === '9' ? this.tabs.at(-1) : this.tabs[Number(key) - 1])?.id);
    }
    if (input.alt && key === 'arrowleft') action = () => this.moveHistory(-1);
    if (input.alt && key === 'arrowright') action = () => this.moveHistory(1);
    if (key === 'escape' && (this.panel || this.active.loading)) action = () => {
      if (this.panel) {
        this.panel = null;
        this.render();
      } else this.active.view?.webContents.stop();
    };
    if (action) {
      event.preventDefault();
      try {
        action();
      } catch (error) {
        this.notify(error.message);
      }
    }
  }

  async perform(action, input = {}) {
    const tab = this.active;
    const contents = tab.view?.webContents;
    const allowPrivate = ['downloads', 'reader'];
    switch (action) {
      case 'state': return this.state();
      case 'tab:new': this.newTab(); this.focusAddress(); break;
      case 'tab:select': this.select(input.id); break;
      case 'tab:close': this.closeTab(input.id); break;
      case 'navigate': {
        this.requireConnection();
        const options = profile.data.settings;
        const target = address(input.value, this.privateMode ? { ...options, search: options.privateSearch } : options);
        if (typeof target === 'string') this.navigate(target);
        else await openFirefox(target.firefoxQuery);
        break;
      }
      case 'navigate:link': {
        const url = webUrl(input.url);
        if (!url) throw new Error('Adresse invalide.');
        this.navigate(url.href);
        break;
      }
      case 'back': this.moveHistory(-1); break;
      case 'forward': this.moveHistory(1); break;
      case 'reload': if (tab.loading) contents?.stop(); else tab.reload(); break;
      case 'private': new Browser(true); break;
      case 'tor:retry':
        if (this.privateMode) await this.checkTor();
        break;
      case 'panel': {
        const valid = ['settings', 'bookmarks', 'history', 'vault', 'extensions', 'home', ...allowPrivate];
        if (input.name !== null && (!valid.includes(input.name) || (this.privateMode && !allowPrivate.includes(input.name)))) {
          throw new Error('Cette page est indisponible dans cette fenêtre.');
        }
        this.panel = this.panel === input.name ? null : input.name;
        if (this.panel === 'reader') {
          const url = webUrl(tab.url);
          if (!url || !contents || tab.error) {
            this.panel = null;
            throw new Error('Ouvre d’abord une page à lire.');
          }
          this.reader = null;
          this.render();
          const article = await isolated(contents, extractArticle, url.origin).catch(() => null);
          if (this.active !== tab || this.panel !== 'reader') break;
          this.reader = article || { title: 'Aucun article détecté', blocks: [] };
        }
        break;
      }
      case 'bookmark:toggle': {
        if (this.privateMode) break;
        if (!webUrl(tab.url) || tab.error || tab.url.length > 8192) throw new Error('Ouvre une page à ajouter aux favoris.');
        const marked = profile.data.bookmarks.some(({ url }) => url === tab.url);
        if (!marked && profile.data.bookmarks.length >= 1000) throw new Error('La limite de favoris est atteinte.');
        profile.commit({
          bookmarks: marked ? profile.data.bookmarks.filter(({ url }) => url !== tab.url)
            : [{ title: tab.summary().title, url: tab.url }, ...profile.data.bookmarks],
        });
        break;
      }
      case 'bookmark:remove':
        if (!this.privateMode) profile.commit({ bookmarks: profile.data.bookmarks.filter(({ url }) => url !== input.url) });
        break;
      case 'history:clear':
        if (!this.privateMode && this.panel === 'history') {
          profile.commit({ history: [] });
          this.history = [];
        }
        break;
      case 'setting': {
        if (this.privateMode || this.panel !== 'settings' || !preference(input.name, input.value)) break;
        profile.commit({ settings: { ...profile.data.settings, [input.name]: input.value } });
        this.save();
        for (const browser of browsers.values()) browser.publish();
        break;
      }
      case 'home:module': {
        if (this.privateMode || this.panel !== 'home' || !HOME_MODULES.includes(input.id)) break;
        const modules = [...profile.data.homeModules];
        const index = modules.indexOf(input.id);
        if (input.enabled === true && index < 0) modules.push(input.id);
        else if (input.enabled === false && index >= 0) modules.splice(index, 1);
        else if ([-1, 1].includes(input.step) && index >= 0 && modules[index + input.step]) {
          [modules[index], modules[index + input.step]] = [modules[index + input.step], modules[index]];
        }
        profile.commit({ homeModules: modules });
        break;
      }
      case 'home:shortcut': {
        if (this.privateMode || this.panel !== 'home') break;
        const old = profile.data.shortcuts;
        if (input.remove === true) {
          profile.commit({ shortcuts: old.filter((item) => item.id !== input.id) });
          break;
        }
        const url = webUrl(input.url);
        const title = typeof input.title === 'string' ? input.title.trim() : '';
        if (!url || url.href.length > 8192 || !title || title.length > 80) throw new Error('Saisis un nom et une adresse HTTP ou HTTPS.');
        if (old.length >= 30) throw new Error('La limite de 30 raccourcis est atteinte.');
        profile.commit({ shortcuts: [...old, { id: randomUUID(), title, url: url.href }] });
        break;
      }
      case 'privacy:clear': {
        if (this.privateMode || this.panel !== 'settings' || !['cache', 'sites'].includes(input.kind)) break;
        if (input.kind === 'cache') await persistent.clearCache();
        else {
          const answer = await dialog.showMessageBox(this.window, {
            type: 'warning', message: 'Effacer les cookies et les données des sites ?',
            detail: 'Les sites pourront te demander de te reconnecter.',
            buttons: ['Annuler', 'Effacer'], defaultId: 0, cancelId: 0,
          });
          if (answer.response !== 1) break;
          const excludeOrigins = extensions.origins();
          await persistent.clearData({
            dataTypes: ['cookies', 'localStorage', 'indexedDB', 'serviceWorkers', 'fileSystems', 'cache'],
            ...(excludeOrigins.length ? { excludeOrigins } : {}),
          });
        }
        this.notify('Les données sélectionnées ont été effacées.');
        break;
      }
      case 'filters:refresh':
        if (!this.privateMode && this.panel === 'settings') await privacy.refresh();
        break;
      case 'download:cancel':
        this.downloads.find(({ id }) => id === input.id)?.item?.cancel();
        break;
      case 'download:show': {
        const record = this.downloads.find(({ id, status }) => id === input.id && status === 'completed');
        if (record?.path) shell.showItemInFolder(record.path);
        break;
      }
      case 'extensions:store-page':
        if (!this.privateMode) this.newTab(STORE);
        break;
      case 'extensions:store': {
        const activeId = storeId(tab.url);
        if (!this.privateMode && (this.panel === 'extensions' || (tab.summary().committed && activeId))) {
          const lookup = this.panel === 'extensions' ? input.value : activeId;
          await extensions.run(() => extensions.addFromStore(this.window, lookup));
          this.panel = 'extensions';
        }
        break;
      }
      case 'extensions:update':
        if (!this.privateMode && this.panel === 'extensions') {
          const entry = extensions.list().find(({ key }) => key === input.key && Boolean(input.key));
          if (entry?.storeId) await extensions.run(() => extensions.addFromStore(this.window, entry.storeId, entry.key));
        }
        break;
      case 'extensions:add':
        if (!this.privateMode && this.panel === 'extensions') await extensions.run(() => extensions.add(this.window));
        break;
      case 'extensions:set':
        if (!this.privateMode && this.panel === 'extensions' && [null, true, false].includes(input.value)) {
          await extensions.run(() => extensions.change(input.key, input.value));
          for (const extensionTab of [...this.tabs]) {
            if (extensionTab.extension && !extensions.allows(extensionTab.extension)) this.closeTab(extensionTab.id);
          }
        }
        break;
      case 'extensions:open':
        if (!this.privateMode && this.panel === 'extensions') {
          const entry = extensions.list().find(({ key }) => key === input.key);
          if (!entry?.page) throw new Error('Cette extension ne fournit pas de page compatible.');
          const extensionTab = this.newTab();
          extensionTab.extension = `chrome-extension://${new URL(entry.page).hostname}/`;
          extensionTab.load(entry.page);
        }
        break;
      case 'vault:unlock':
        if (!this.privateMode && this.panel === 'vault') await vault.unlock(input.code, input.confirmation);
        break;
      case 'vault:lock':
        if (!this.privateMode) vault.lock();
        break;
      case 'vault:put':
        if (!this.privateMode && this.panel === 'vault') vault.put(input);
        break;
      case 'vault:remove':
        if (!this.privateMode && this.panel === 'vault') vault.remove(input.id);
        break;
      case 'vault:copy':
        if (!this.privateMode && this.panel === 'vault') {
          vault.copy(input.id, input.origin);
          this.notify('Mot de passe copié pour 30 secondes.');
        }
        break;
      case 'vault:fill':
        if (!this.privateMode && this.panel === 'vault') {
          const url = webUrl(tab.url);
          if (!url || url.protocol !== 'https:' || !contents || tab.error || tab.loading || contents.getURL() !== url.href) {
            throw new Error('Ouvre la page de connexion HTTPS du site avant de remplir le formulaire.');
          }
          const credentials = vault.get(input.id, url.origin);
          this.panel = null;
          this.render();
          contents.focus();
          const filled = await isolated(contents, fillLogin, url.origin, credentials).catch(() => false);
          this.notify(filled ? 'Identifiants remplis. Vérifie le formulaire avant de l’envoyer.'
            : 'Aucun formulaire de connexion compatible sur cette page.');
        }
        break;
      case 'zoom':
        if ([-0.1, 0, 0.1].includes(input.value)) this.zoom(input.value);
        break;
      default: throw new Error('Action inconnue.');
    }
    this.render();
    return this.state();
  }
}

async function start() {
  const directory = app.getPath('userData');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  Menu.setApplicationMenu(null);
  profile = new Profile(directory);
  const listsSession = session.fromPartition('openweb-filter-downloads');
  privacy = new Privacy(native, directory, (url, options) => listsSession.fetch(url, options), () => {
    for (const browser of browsers.values()) browser.publish();
  });
  persistent = session.fromPartition('persist:openweb-web');
  setupSession(persistent);
  const storeSession = session.fromPartition('openweb-store-downloads');
  extensions = new Extensions(persistent, profile, directory, (url, options) => storeSession.fetch(url, options));
  vault = new Vault(native, directory, () => regular?.publish());
  powerMonitor.on('suspend', () => vault.lock());
  powerMonitor.on('lock-screen', () => vault.lock());

  ipcMain.handle('openweb:action', async (event, action, input) => {
    const browser = browsers.get(event.sender.id);
    if (!browser || event.senderFrame !== event.sender.mainFrame || event.senderFrame?.url !== HOME_URL) {
      return { error: 'Action inaccessible depuis cette page.' };
    }
    try {
      return { state: await browser.perform(action, input) };
    } catch (error) {
      return { error: error.message || 'Une erreur est survenue.' };
    }
  });

  await Promise.all([privacy.initialize(), extensions.initialize()]);
  regular = new Browser();
  app.on('activate', () => {
    if (!regular) regular = new Browser();
  });
  app.on('second-instance', () => {
    if (!regular) regular = new Browser();
    if (regular.window.isMinimized()) regular.window.restore();
    regular.window.focus();
  });
}

if (app.requestSingleInstanceLock()) {
  void app.whenReady().then(start).catch((error) => {
    dialog.showErrorBox('OpenWeb', error.message);
    app.exit(1);
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
} else app.quit();
