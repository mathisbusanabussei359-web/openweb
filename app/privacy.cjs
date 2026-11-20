const fs = require('node:fs/promises');
const path = require('node:path');
const { stripTracking, thirdPartyResource, removeHeaders } = require('./privacy-rules.cjs');

const LISTS = ['https://easylist.to/easylist/easylist.txt', 'https://easylist.to/easylist/easyprivacy.txt'];
const LIMIT = 8 * 1024 * 1024;
const WEEK = 7 * 24 * 60 * 60 * 1000;
const BASIC_RULES = [
  '||doubleclick.net^$third-party',
  '||googlesyndication.com^$third-party',
  '||google-analytics.com^$third-party',
  '||adservice.google.com^$third-party',
  '||adnxs.com^$third-party',
  '||scorecardresearch.com^$third-party',
].join('\n');
const RESOURCE_TYPES = {
  mainFrame: 'document',
  subFrame: 'subdocument',
  xhr: 'xmlhttprequest',
  webSocket: 'websocket',
  cspReport: 'csp_report',
};

async function downloadList(url, fetch) {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(25_000) });
  if (!response.ok || !response.body) throw new Error('Liste de filtrage indisponible.');
  let size = 0;
  const parts = [];
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > LIMIT) throw new Error('Liste de filtrage trop volumineuse.');
    parts.push(chunk);
  }
  const rules = Buffer.concat(parts).toString('utf8');
  if (!/^\[Adblock Plus[^\r\n]*\]/.test(rules) || size < 50_000) throw new Error('Format de liste inattendu.');
  return rules;
}

class Privacy {
  constructor(native, directory, fetch, changed) {
    this.native = native;
    this.cache = path.join(directory, 'filters.txt');
    this.fetch = fetch;
    this.changed = changed;
    this.engine = null;
    this.status = 'Chargement des règles…';
    this.refreshing = false;
  }

  async initialize() {
    this.engine = await this.native.compileFilter(BASIC_RULES);
    this.status = 'Règles de base';
    let fresh = false;
    try {
      const info = await fs.stat(this.cache);
      if (info.size > LIMIT * LISTS.length) throw new Error('Cache de filtrage trop volumineux.');
      this.engine = await this.native.compileFilter(await fs.readFile(this.cache, 'utf8'));
      this.status = 'EasyList et EasyPrivacy';
      fresh = Date.now() - info.mtimeMs < WEEK;
    } catch {
      // The bundled rules apply while downloading or when offline.
    }
    if (!fresh) void this.refresh().catch(() => {});
  }

  async refresh() {
    if (this.refreshing) throw new Error('Une mise à jour est déjà en cours.');
    this.refreshing = true;
    const temporary = `${this.cache}.tmp`;
    try {
      const lists = await Promise.all(LISTS.map((url) => downloadList(url, this.fetch)));
      const rules = lists.join('\n');
      const engine = await this.native.compileFilter(rules);
      await fs.writeFile(temporary, rules, { mode: 0o600 });
      await fs.rename(temporary, this.cache);
      this.engine = engine;
      this.status = 'EasyList et EasyPrivacy';
      this.changed();
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => {});
      this.refreshing = false;
    }
  }

  configure(session, settings, ownTab) {
    session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.setPermissionCheckHandler(() => false);
    session.setDevicePermissionHandler(() => false);
    session.setDisplayMediaRequestHandler((_request, callback) => callback({}));
    const filter = { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] };
    session.webRequest.onBeforeRequest(filter, (details, callback) => {
      const options = settings();
      if (options.blockPings && details.resourceType === 'ping') return callback({ cancel: true });
      if (details.resourceType === 'mainFrame') {
        if (options.httpsOnly && details.url.startsWith('http:')) return callback({ cancel: true });
        if (options.stripTracking && details.method === 'GET') {
          const clean = stripTracking(details.url);
          if (clean !== details.url) return callback({ redirectURL: clean });
        }
        return callback({});
      }
      if (!options.blocking || !this.engine) return callback({});
      const source = details.initiatorOrigin?.startsWith('http')
        ? details.initiatorOrigin
        : details.referrer || details.url;
      const kind = RESOURCE_TYPES[details.resourceType] ?? details.resourceType;
      const blocked = this.engine.blocks(details.url, source, kind, details.method);
      if (blocked) ownTab(details.webContentsId)?.countBlocked();
      callback({ cancel: blocked });
    });
    session.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
      const options = settings();
      const headers = details.requestHeaders;
      if (options.doNotTrack) {
        removeHeaders(headers, 'dnt', 'sec-gpc');
        headers.DNT = '1';
        headers['Sec-GPC'] = '1';
      }
      if (options.thirdPartyCookies && thirdPartyResource(details, ownTab(details.webContentsId))) {
        removeHeaders(headers, 'cookie', 'cookie2');
      }
      callback({ requestHeaders: headers });
    });
    session.webRequest.onHeadersReceived(filter, (details, callback) => {
      if (!settings().thirdPartyCookies || !details.responseHeaders
        || !thirdPartyResource(details, ownTab(details.webContentsId))) return callback({});
      removeHeaders(details.responseHeaders, 'set-cookie', 'set-cookie2');
      callback({ responseHeaders: details.responseHeaders });
    });
  }
}

module.exports = { Privacy };
