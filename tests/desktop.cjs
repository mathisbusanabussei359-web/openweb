const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { app, BrowserWindow, dialog, session } = require('electron');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openweb-desktop-'));
const data = path.join(root, 'profile');
const ext = path.join(root, 'content-script');
fs.mkdirSync(data);
fs.mkdirSync(ext);
app.setPath('userData', data);

fs.writeFileSync(path.join(data, 'filters.txt'), 'openweb-test-ad.png$image\n');
fs.writeFileSync(path.join(ext, 'manifest.json'), JSON.stringify({
  manifest_version: 3,
  name: 'OpenWeb test content script',
  version: '1.0.0',
  content_scripts: [{ matches: ['https://127.0.0.1/*'], js: ['content.js'] }],
}));
fs.writeFileSync(path.join(ext, 'content.js'), 'document.documentElement.dataset.openwebExtension = "loaded";');
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [ext] });
dialog.showMessageBox = async () => ({ response: 1 });
dialog.showErrorBox = (title, message) => console.error(title, message);

const key = path.join(root, 'key.pem');
const cert = path.join(root, 'cert.pem');
execFileSync('openssl', [
  'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-keyout', key, '-out', cert,
  '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1,IP:127.0.0.2',
], { stdio: 'ignore' });
const certificate = fs.readFileSync(cert);
const { X509Certificate } = require('node:crypto');
const fingerprint = new X509Certificate(certificate).fingerprint256;
let requestHeaders;
let adRequests = 0;
const server = https.createServer({ key: fs.readFileSync(key), cert: certificate }, (request, response) => {
  if (request.url.startsWith('/openweb-test-ad.png')) {
    adRequests += 1;
    return response.writeHead(200).end('fixture');
  }
  if (request.url === '/redirect') return response.writeHead(302, { Location: '/linked' }).end();
  if (request.url === '/download') {
    return response.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': 'attachment; filename="openweb-test.txt"',
    }).end('payload');
  }
  requestHeaders = request.headers;
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(
    '<!doctype html><title>OpenWeb Test</title><main><h1>Article test</h1>'
    + `<p>${'Un paragraphe visible pour vérifier le mode lecture. '.repeat(6)}</p>`
    + '<form action="/session"><label>Identifiant <input name="user" autocomplete="username"></label>'
    + '<label>Mot de passe <input name="password" type="password" autocomplete="current-password"></label></form>'
    + '<a id="test-redirect" href="/redirect">Suivre le lien</a><img src="/openweb-test-ad.png"></main>',
  );
});

app.on('certificate-error', (event, _contents, url, _error, certDetails, callback) => {
  const host = new URL(url).hostname;
  if (['127.0.0.1', '127.0.0.2'].includes(host) && new X509Certificate(certDetails.data).fingerprint256 === fingerprint) {
    event.preventDefault();
    callback(true);
  }
});

require('../app/main.cjs');

async function waitFor(check, label) {
  const end = Date.now() + 12_000;
  while (Date.now() < end) {
    const value = await check();
    if (value) return value;
    await delay(50);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

const ui = (window, script) => window.webContents.executeJavaScript(script);
const execute = (window, action, input) => ui(window, `window.openweb.action(${JSON.stringify(action)}, ${JSON.stringify(input)})`);
async function command(window, action, input) {
  const result = await execute(window, action, input);
  assert.equal(result.error, undefined, result.error);
  return result.state;
}

const guest = (window) => window.contentView.children.find((view) => view.webContents !== window.webContents)?.webContents;
async function navigate(window, url) {
  await command(window, 'navigate', { value: url });
  await waitFor(async () => {
    const { active } = await command(window, 'state');
    if (active.error) throw new Error(`Navigation error: ${active.error}`);
    return active.committed && !active.loading && active.url === url;
  }, url);
  return guest(window);
}

async function run() {
  await Promise.all([
    app.whenReady(),
    new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '0.0.0.0', resolve);
    }),
  ]);
  const address = `https://127.0.0.1:${server.address().port}`;
  const window = await waitFor(() => BrowserWindow.getAllWindows().find((candidate) =>
    candidate.webContents.getURL().endsWith('/ui/index.html') && !candidate.webContents.isLoading()), 'browser UI');
  await waitFor(() => ui(window, 'Boolean(document.querySelector(".tab-select"))'), 'first tab');
  assert.equal(await ui(window, "document.querySelector('#home-title').textContent"), 'OpenWeb');

  // Submit through the real address-bar form to exercise renderer bindings.
  await ui(window, `document.querySelector('#address').value = ${JSON.stringify(address + '/login')};
    document.querySelector('#address-form').requestSubmit(); true`);
  const page = await waitFor(async () => {
    const { active } = await command(window, 'state');
    if (active.error) throw new Error(`Navigation error: ${active.error}`);
    return active.committed && !active.loading && guest(window);
  }, 'HTTPS page from the address bar');
  assert.equal(await page.getTitle(), 'OpenWeb Test');
  assert.equal(await page.executeJavaScript('typeof window.openweb + "," + typeof require'), 'undefined,undefined');
  assert.equal(adRequests, 0);
  assert.equal((await command(window, 'state')).active.blocked, 1);
  assert.equal(requestHeaders.dnt, '1');
  assert.equal(requestHeaders['sec-gpc'], '1');
  const point = await page.executeJavaScript(`(() => {
    const { x, y, height } = document.querySelector('#test-redirect').getBoundingClientRect();
    return { x: Math.ceil(x + 5), y: Math.floor(y + height / 2) };
  })()`);
  window.focus();
  page.focus();
  page.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
  page.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
  await waitFor(async () => {
    const { active } = await command(window, 'state');
    return active.url === address + '/linked' && !active.loading;
  }, 'link redirect');
  await command(window, 'back');
  await waitFor(async () => {
    const { active } = await command(window, 'state');
    if (active.error) throw new Error(`Back failed: ${active.error}`);
    return active.url === address + '/login' && !active.loading;
  }, 'history back');

  await command(window, 'bookmark:toggle');
  const bookmarks = await command(window, 'panel', { name: 'bookmarks' });
  assert.equal(bookmarks.bookmarks[0].url, address + '/login');
  const article = await command(window, 'panel', { name: 'reader' });
  assert.equal(article.reader.title, 'OpenWeb Test');
  assert.ok(article.reader.blocks.length >= 2);

  await command(window, 'panel', { name: 'vault' });
  const code = 'test OpenWeb phrase maître';
  await command(window, 'vault:unlock', { code, confirmation: code });
  const password = 'fake browser test secret';
  const { vault } = await command(window, 'vault:put', { site: address, username: 'alice', password });
  assert.equal(vault.entries.length, 1);
  assert.equal(JSON.stringify(vault).includes(password), false);
  const id = vault.entries[0].id;
  await command(window, 'vault:fill', { id });
  assert.deepEqual(await page.executeJavaScript('[document.forms[0].user.value, document.forms[0].password.value]'), ['alice', password]);
  const other = address.replace('127.0.0.1', '127.0.0.2');
  const unrelated = await navigate(window, other + '/lookalike');
  await command(window, 'panel', { name: 'vault' });
  assert.match((await execute(window, 'vault:fill', { id })).error, /introuvable/);
  assert.equal(await unrelated.executeJavaScript('document.forms[0].password.value'), '');
  await command(window, 'vault:lock');

  await command(window, 'panel', { name: 'settings' });
  await command(window, 'setting', { name: 'blocking', value: false });
  const normal = await navigate(window, address + '/regular');
  assert.ok(adRequests >= 1);
  await normal.executeJavaScript("document.cookie = 'regularSession=1; SameSite=Strict'");
  const savePath = path.join(root, 'download.txt');
  normal.session.once('will-download', (_event, item) => item.setSavePath(savePath));
  normal.downloadURL(address + '/download');
  await command(window, 'panel', { name: 'downloads' });
  await waitFor(async () => (await command(window, 'state')).downloads[0]?.status === 'completed', 'download');
  assert.equal(fs.readFileSync(savePath, 'utf8'), 'payload');

  await command(window, 'panel', { name: 'extensions' });
  const installed = await command(window, 'extensions:add');
  assert.equal(installed.extensions[0].name, 'OpenWeb test content script');
  const content = await navigate(window, address + '/extension');
  assert.equal(await content.executeJavaScript('document.documentElement.dataset.openwebExtension'), 'loaded');
  await command(window, 'panel', { name: 'extensions' });
  await command(window, 'extensions:set', { key: installed.extensions[0].key, value: false });
  const disabled = await navigate(window, address + '/disabled');
  assert.equal(await disabled.executeJavaScript('document.documentElement.dataset.openwebExtension'), undefined);
  await command(window, 'panel', { name: 'extensions' });
  await command(window, 'extensions:set', { key: installed.extensions[0].key, value: true });

  await command(window, 'private');
  const privateWindow = await waitFor(() => BrowserWindow.getAllWindows().find((candidate) =>
    candidate !== window && candidate.webContents.getURL().endsWith('/ui/index.html')
    && !candidate.webContents.isLoading()), 'private window');
  assert.equal((await command(privateWindow, 'state')).privateMode, true);
  const privatePage = await navigate(privateWindow, address + '/private-record');
  assert.equal(await privatePage.executeJavaScript('document.cookie'), '');
  assert.equal(await privatePage.executeJavaScript('document.documentElement.dataset.openwebExtension'), undefined);
  assert.match((await execute(privateWindow, 'panel', { name: 'vault' })).error, /indisponible/);
  privateWindow.close();
  const history = await command(window, 'panel', { name: 'history' });
  assert.ok(history.history.some(({ url }) => url === address + '/disabled'));
  assert.equal(history.history.some(({ url }) => url.includes('private-record')), false);

  const { tabs } = await command(window, 'tab:new');
  assert.equal(tabs.length, 2);
  await command(window, 'tab:close', { id: tabs[1].id });
  assert.deepEqual((await command(window, 'state')).tabs.map(({ id: tabId }) => tabId), [tabs[0].id]);
  const installedList = await command(window, 'panel', { name: 'extensions' });
  await command(window, 'extensions:set', { key: installedList.extensions[0].key, value: null });
  assert.equal(session.fromPartition('persist:openweb-web').extensions.getAllExtensions().length, 0);
  console.log('Desktop smoke test passed: navigation, filters, favorites, reader, vault, downloads, extensions and private browsing.');
}

function finish(error) {
  if (error) console.error(error);
  app.once('will-quit', () => {
    server.close();
    fs.rmSync(root, { recursive: true, force: true });
    app.exit(error ? 1 : 0);
  });
  app.quit();
}

run().then(() => finish(), finish);
