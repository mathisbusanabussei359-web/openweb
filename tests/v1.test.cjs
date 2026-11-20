const assert = require('node:assert/strict');
const { createHash, generateKeyPairSync, sign } = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { crc32 } = require('node:zlib');
const { test } = require('node:test');
const { address } = require('../app/navigation.cjs');
const { Profile } = require('../app/profile.cjs');
const { stripTracking, thirdPartyResource } = require('../app/privacy-rules.cjs');
const { connectTor } = require('../app/tor.cjs');
const { chromeId, extractZip, storeId, verifyCrx } = require('../app/webstore.cjs');

test('search engines resolve to their actual endpoints and Firefox dispatch stays explicit', () => {
  const expected = {
    brave: 'https://search.brave.com/search?q=caf%C3%A9%20du%20jour',
    bing: 'https://www.bing.com/search?q=caf%C3%A9%20du%20jour',
    startpage: 'https://www.startpage.com/sp/search?query=caf%C3%A9%20du%20jour',
    ecosia: 'https://www.ecosia.org/search?q=caf%C3%A9%20du%20jour',
  };
  for (const [search, url] of Object.entries(expected)) assert.equal(address('café du jour', { search }), url);
  assert.deepEqual(address('café du jour', { search: 'firefox' }), { firefoxQuery: 'café du jour' });
  assert.equal(address('https://example.org/', { search: 'firefox' }), 'https://example.org/');
});

test('tracking cleanup keeps other parameters unmodified and preserves signed addresses', () => {
  assert.equal(stripTracking('https://example.org/?utm_source=test&q=one%20two%2b&fbclid=test#t'), 'https://example.org/?q=one%20two%2b#t');
  assert.equal(stripTracking('https://example.org/?gclid=1'), 'https://example.org/');
  for (const url of [
    'https://example.org/?gclid=1&X-Amz-Signature=abc', 'https://example.org/?utm_source=a&state=csrf',
    'https://example.org/#section?utm_id=hash',
  ]) assert.equal(stripTracking(url), url);
});

test('site classification separates private public suffixes and ignores ports', () => {
  const isThirdParty = (url, top, resourceType = 'image') => thirdPartyResource({ url, resourceType }, { url: top });
  assert.equal(isThirdParty('https://static.example.co.uk:8443/icon', 'https://www.example.co.uk/'), false);
  assert.equal(isThirdParty('https://a.github.io/icon', 'https://b.github.io/'), true);
  assert.equal(isThirdParty('wss://static.example.org/socket', 'https://example.org/'), false);
  assert.equal(isThirdParty('https://login.example.com/', 'https://other.example.org/', 'mainFrame'), false);
});

test('Tor accepts only the pinned loopback SOCKS route and a positive Tor check', async () => {
  const calls = [];
  const context = {
    setProxy: async (options) => calls.push(options),
    closeAllConnections: async () => calls.push('closed'),
    resolveProxy: async () => 'SOCKS5 127.0.0.1:9150',
    fetch: async (url, options) => {
      calls.push([url, options.credentials, options.redirect]);
      return { ok: true, json: async () => ({ IsTor: true }) };
    },
  };
  await connectTor(context, 9150);
  assert.deepEqual(calls, [
    { mode: 'fixed_servers', proxyRules: 'socks5://127.0.0.1:9150', proxyBypassRules: '<-loopback>' },
    'closed', ['https://check.torproject.org/api/ip', 'omit', 'error'],
  ]);
  context.fetch = async () => ({ ok: true, json: async () => ({ IsTor: false }) });
  await assert.rejects(connectTor(context, 9150), /non confirmée/);
  context.resolveProxy = async () => 'DIRECT';
  context.fetch = async () => assert.fail('Traffic must not be attempted on a direct route');
  await assert.rejects(connectTor(context, 9150), /proxy Tor/);
});

test('existing profiles keep history, links and preferences when opening V1', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'openweb-profile-v1-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.writeFile(path.join(directory, 'openweb.json'), JSON.stringify({
    settings: { search: 'qwant', dark: true }, history: [{ url: 'https://example.org/', title: 'Example' }],
    bookmarks: [{ url: 'https://example.org/', title: 'Favori' }],
  }));
  const profile = new Profile(directory);
  assert.equal(profile.data.settings.search, 'qwant');
  assert.equal(profile.data.settings.dark, true);
  assert.equal(profile.data.settings.privateSearch, 'duckduckgo');
  assert.equal(profile.data.history[0].visits, 1);
  assert.equal(profile.data.bookmarks[0].title, 'Favori');
  profile.commit({ homeModules: ['frequent', 'shortcuts'] });
  assert.deepEqual(new Profile(directory).data.homeModules, ['frequent', 'shortcuts']);
});

function varint(integer) {
  const bytes = [];
  while (integer > 127) {
    bytes.push((integer & 127) | 128);
    integer >>>= 7;
  }
  return Buffer.from([...bytes, integer]);
}

function proto(field, data) {
  return Buffer.concat([varint((field << 3) | 2), varint(data.length), data]);
}

function crxFixture() {
  const developer = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const publisher = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const pubkey = (pair) => pair.publicKey.export({ format: 'der', type: 'spki' });
  const digest = (key) => createHash('sha256').update(key).digest();
  const id = digest(pubkey(developer)).subarray(0, 16);
  const signed = proto(1, id);
  const length = Buffer.alloc(4);
  length.writeUInt32LE(signed.length);
  const zip = Buffer.from('test payload');
  const message = Buffer.concat([Buffer.from('CRX3 SignedData\0'), length, signed, zip]);
  const proof = (pair) => Buffer.concat([proto(1, pubkey(pair)), proto(2, sign('sha256', message, pair.privateKey))]);
  const header = Buffer.concat([proto(2, proof(developer)), proto(3, proof(publisher)), proto(10000, signed)]);
  const fixed = Buffer.alloc(12);
  fixed.write('Cr24');
  fixed.writeUInt32LE(3, 4);
  fixed.writeUInt32LE(header.length, 8);
  return { bytes: Buffer.concat([fixed, header, zip]), id: chromeId(id), publisher: digest(pubkey(publisher)).toString('hex'), zip };
}

test('installation accepts only store links or ids and validates publisher, ID and bytes', () => {
  const { bytes, id, publisher, zip } = crxFixture();
  assert.equal(storeId(`https://chromewebstore.google.com/detail/example/${id}?hl=fr`), id);
  assert.equal(storeId(`https://chrome.google.com/webstore/detail/example/${id}`), id);
  assert.equal(storeId(`https://chromewebstore.google.com.example.net/detail/example/${id}`), null);
  assert.equal(storeId(`https://user@chromewebstore.google.com/detail/example/${id}`), null);
  assert.deepEqual(verifyCrx(bytes, id, publisher).zip, zip);
  assert.throws(() => verifyCrx(bytes, 'a'.repeat(32), publisher));
  assert.throws(() => verifyCrx(bytes, id));
  bytes[bytes.length - 1] ^= 1;
  assert.throws(() => verifyCrx(bytes, id, publisher));
});

function zipEntry(name) {
  const file = Buffer.from(name);
  const contents = Buffer.from('{}');
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50);
  local.writeUInt32LE(crc32(contents), 14);
  local.writeUInt32LE(contents.length, 18);
  local.writeUInt32LE(contents.length, 22);
  local.writeUInt16LE(file.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50);
  central.writeUInt32LE(crc32(contents), 16);
  central.writeUInt32LE(contents.length, 20);
  central.writeUInt32LE(contents.length, 24);
  central.writeUInt16LE(file.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + file.length, 12);
  end.writeUInt32LE(local.length + file.length + contents.length, 16);
  return Buffer.concat([local, file, contents, central, file, end]);
}

test('archive extraction writes ordinary files and refuses unsafe paths', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'openweb-zip-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await extractZip(zipEntry('manifest.json'), path.join(directory, 'safe'));
  assert.equal(await fs.readFile(path.join(directory, 'safe', 'manifest.json'), 'utf8'), '{}');
  await assert.rejects(extractZip(zipEntry('../outside.json'), path.join(directory, 'invalid')));
  await assert.rejects(fs.stat(path.join(directory, 'outside.json')), { code: 'ENOENT' });
});
