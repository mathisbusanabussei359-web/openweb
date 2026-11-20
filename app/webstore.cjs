const { createHash, createPublicKey, createVerify } = require('node:crypto');
const { createWriteStream } = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const yauzl = require('yauzl');

const STORE = 'https://chromewebstore.google.com/';
const ID = /^[a-p]{32}$/;
// Chromium's production CRX3 publisher key hash (components/crx_file/crx_verifier.cc).
const PUBLISHER = '61f7f2a6bfcf74cd0bc1fe2497cc9b04254c658f79f2145392867ea8366367cf';
const LIMIT = 100 * 1024 * 1024;

function storeId(input) {
  if (typeof input !== 'string' || input.length > 2048) return null;
  if (ID.test(input.trim())) return input.trim();
  try {
    const url = new URL(input);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    const prefix = url.hostname === 'chromewebstore.google.com' ? '/detail/'
      : url.hostname === 'chrome.google.com' ? '/webstore/detail/' : null;
    if (!prefix || !url.pathname.startsWith(prefix)) return null;
    const parts = url.pathname.slice(prefix.length).replace(/\/$/, '').split('/');
    return parts.length <= 2 && ID.test(parts.at(-1)) ? parts.at(-1) : null;
  } catch {
    return null;
  }
}

function chromeId(bytes) {
  return bytes.toString('hex').replace(/[\da-f]/gu, (digit) => String.fromCharCode(97 + parseInt(digit, 16)));
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest();
}

function invalidPackage() {
  return new Error('Impossible de vérifier la signature du Chrome Web Store.');
}

function protobufBytes(buffer) {
  const fields = new Map();
  let position = 0;
  function varint() {
    let value = 0;
    for (let shift = 0; shift <= 28; shift += 7) {
      if (position >= buffer.length) throw invalidPackage();
      const byte = buffer[position++];
      value += (byte & 127) * 2 ** shift;
      if (byte < 128 && value <= 0xffffffff) return value;
    }
    throw invalidPackage();
  }
  while (position < buffer.length) {
    const tag = varint();
    const field = tag >>> 3;
    const wire = tag & 7;
    if (!field) throw invalidPackage();
    if (wire === 0) varint();
    else if (wire === 1 || wire === 5) position += wire === 1 ? 8 : 4;
    else if (wire === 2) {
      const length = varint();
      if (length > buffer.length - position) throw invalidPackage();
      if (!fields.has(field)) fields.set(field, []);
      fields.get(field).push(buffer.subarray(position, position + length));
      position += length;
    } else throw invalidPackage();
    if (position > buffer.length) throw invalidPackage();
  }
  return fields;
}

function unique(fields, index) {
  const values = fields.get(index);
  if (values?.length !== 1 || !values[0].length) throw invalidPackage();
  return values[0];
}

function verifyCrx(bytes, expectedId, publisher = PUBLISHER) {
  if (bytes.length < 16 || bytes.length > LIMIT || bytes.toString('ascii', 0, 4) !== 'Cr24'
    || bytes.readUInt32LE(4) !== 3) throw invalidPackage();
  const count = bytes.readUInt32LE(8);
  if (count > 256 * 1024 || count >= bytes.length - 12) throw invalidPackage();
  const header = protobufBytes(bytes.subarray(12, 12 + count));
  const signed = unique(header, 10000);
  const id = unique(protobufBytes(signed), 1);
  if (id.length !== 16 || chromeId(id) !== expectedId) throw invalidPackage();
  const zip = bytes.subarray(12 + count);
  const signedLength = Buffer.alloc(4);
  signedLength.writeUInt32LE(signed.length);
  const proofs = [...(header.get(2) ?? []).map((proof) => [proof, 'rsa']),
    ...(header.get(3) ?? []).map((proof) => [proof, 'ec'])];
  if (!proofs.length || proofs.length > 10) throw invalidPackage();

  let published = false;
  let developer;
  for (const [proof, algorithm] of proofs) {
    const fields = protobufBytes(proof);
    const keyBytes = unique(fields, 1);
    const signature = unique(fields, 2);
    const key = createPublicKey({ key: keyBytes, format: 'der', type: 'spki' });
    const verifier = createVerify('sha256');
    verifier.update('CRX3 SignedData\0').update(signedLength).update(signed).update(zip);
    if (key.asymmetricKeyType !== algorithm || !verifier.verify(key, signature)) throw invalidPackage();
    const hash = digest(keyBytes);
    if (hash.toString('hex') === publisher) published = true;
    if (hash.subarray(0, 16).equals(id)) developer = keyBytes.toString('base64');
  }
  if (!published || !developer) throw invalidPackage();
  return { zip, key: developer };
}

function safeParts(name) {
  const parts = name.replace(/\/$/, '').split('/');
  if (parts.length > 30 || parts.some((part) => !part || part === '.' || part === '..'
    || /[<>:\x00-\x1f\\|?*"]/u.test(part) || /[ .]$/u.test(part)
    || /^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)/iu.test(part))) {
    throw new Error('Chemin de fichier invalide dans l’extension.');
  }
  return parts;
}

async function extractZip(buffer, directory) {
  await fs.mkdir(directory, { mode: 0o700 });
  const zip = await yauzl.fromBufferPromise(buffer, { strictFileNames: true, validateEntrySizes: true });
  try {
    if (zip.entryCount > 10_000) throw new Error('L’extension contient trop de fichiers.');
    let size = 0;
    const names = new Set();
    for await (const entry of zip.eachEntry()) {
      const parts = safeParts(entry.fileName);
      // Chromium reserves this directory for verified-install metadata.
      if (parts[0].toLowerCase() === '_metadata') continue;
      const target = path.join(directory, ...parts);
      const identity = parts.join('/').normalize('NFC').toLowerCase();
      if (names.has(identity)) throw new Error('Fichiers en double dans l’extension.');
      names.add(identity);
      const kind = (entry.externalFileAttributes >>> 16) & 0o170000;
      const folder = entry.fileName.endsWith('/');
      if (kind && kind !== (folder ? 0o040000 : 0o100000)) throw new Error('Type de fichier invalide dans l’extension.');
      size += entry.uncompressedSize;
      if (size > LIMIT) throw new Error('L’extension est trop volumineuse.');
      if (folder) await fs.mkdir(target, { recursive: true, mode: 0o700 });
      else {
        await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
        const stream = await zip.openReadStreamPromise(entry);
        await pipeline(stream, createWriteStream(target, { flags: 'wx', mode: 0o600 }));
      }
    }
  } finally {
    zip.close();
  }
}

function downloadHost(url) {
  return url.protocol === 'https:' && !url.username && !url.password && !url.port
    && ((url.hostname === 'clients2.google.com' && url.pathname.startsWith('/service/update2/crx'))
      || (['clients2.googleusercontent.com', 'clients2.google.com'].includes(url.hostname) && url.pathname.startsWith('/crx/'))
      || (url.hostname === 'update.googleapis.com' && url.pathname.startsWith('/service/update2/crx')));
}

async function downloadCrx(id, fetch, chromiumVersion) {
  let url = new URL('https://clients2.google.com/service/update2/crx');
  url.search = new URLSearchParams({
    response: 'redirect', prodversion: chromiumVersion, acceptformat: 'crx3', x: `id=${id}&installsource=ondemand&uc`,
  }).toString();
  const signal = AbortSignal.timeout(60_000);
  for (let hop = 0; hop < 5; hop += 1) {
    if (!downloadHost(url)) throw new Error('Redirection refusée par OpenWeb.');
    const result = await fetch(url.href, { redirect: 'manual', signal, credentials: 'omit' });
    if (result.status >= 300 && result.status < 400 && result.headers.has('location')) {
      if (result.body) await result.body.cancel();
      url = new URL(result.headers.get('location'), url);
      continue;
    }
    if (result.status !== 200 || !result.body) throw new Error('Cette extension publique est indisponible pour cette version de Chromium.');
    const chunks = [];
    let size = 0;
    for await (const chunk of result.body) {
      size += chunk.byteLength;
      if (size > LIMIT) throw new Error('L’extension est trop volumineuse.');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks, size);
  }
  throw new Error('Trop de redirections pour le téléchargement.');
}

async function stageStoreExtension(input, directory, fetch, chromiumVersion) {
  const id = storeId(input);
  if (!id) throw new Error('Colle le lien d’une fiche du Chrome Web Store.');
  const bytes = await downloadCrx(id, fetch, chromiumVersion);
  let verified;
  try {
    verified = verifyCrx(bytes, id);
  } catch {
    throw invalidPackage();
  }
  await extractZip(verified.zip, directory);
  return { id, key: verified.key };
}

module.exports = { STORE, storeId, verifyCrx, extractZip, stageStoreExtension, chromeId };
