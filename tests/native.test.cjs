const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { compileFilter, openVault, vaultExists } = require('../app/openweb-native.node');

test('the native filter blocks third-party resources and respects exceptions', async () => {
  const filter = await compileFilter('||ads.example.org^$third-party,script\n@@||ads.example.org/allowed.js');
  const source = 'https://page.example.net/';
  assert.equal(filter.blocks('https://ads.example.org/tracker.js', source, 'script', 'GET'), true);
  assert.equal(filter.blocks('https://ads.example.org/allowed.js', source, 'script', 'GET'), false);
  assert.equal(filter.blocks('https://ads.example.org/ad.png', source, 'image', 'GET'), false);
  assert.equal(filter.blocks('https://ads.example.org/tracker.js', 'https://example.org/', 'script', 'GET'), false);
});

test('the vault persists replacements, authenticates data and enforces origin and lock boundaries', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'openweb-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'vault.openweb');
  const code = 'un code maître de test';
  const origin = 'https://example.org';

  assert.equal(vaultExists(file), false);
  assert.throws(() => openVault(file, '1234', true), /12 caractères/);
  const vault = await openVault(file, code, true);
  assert.equal(vaultExists(file), true);
  vault.put('id', origin, 'alice', 'initial secret');
  const old = fs.readFileSync(file);
  vault.put('id', origin, 'alice', 'replacement secret');
  const encrypted = fs.readFileSync(file);
  assert.notDeepEqual(old.subarray(24, 48), encrypted.subarray(24, 48));
  for (const plaintext of ['replacement secret', 'initial secret', 'alice', origin, code]) {
    assert.equal(encrypted.includes(plaintext), false);
  }

  assert.throws(() => vault.login('id', 'https://example.org:4000'), /introuvable/);
  vault.lock();
  assert.throws(() => vault.entries(), /verrouillé/);
  await assert.rejects(openVault(file, 'a different valid code', false), /incorrect/);
  await assert.rejects(openVault(file, code, true), /remplacer/);
  assert.deepEqual(fs.readFileSync(file), encrypted);
  const reopened = await openVault(file, code, false);
  assert.deepEqual(reopened.entries(), [{ id: 'id', origin, username: 'alice' }]);
  assert.deepEqual(reopened.login('id', origin), { username: 'alice', password: 'replacement secret' });
  reopened.remove('id');
  reopened.lock();
  const empty = await openVault(file, code, false);
  assert.deepEqual(empty.entries(), []);
  empty.lock();

  encrypted[encrypted.length - 1] ^= 1;
  fs.writeFileSync(file, encrypted);
  await assert.rejects(openVault(file, code, false), /endommagé/);
});

test('the vault rolls back an edit when disk persistence fails', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'openweb-recovery-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const backup = path.join(directory, 'backup');
  const file = path.join(directory, 'vault.openweb');
  const vault = await openVault(file, 'un code maître de test', true);
  const origin = 'https://example.org';
  vault.put('id', origin, 'alice', 'secret');
  fs.renameSync(file, backup);
  fs.mkdirSync(file);
  assert.throws(() => vault.put('id', origin, 'changed', 'new secret'), /remplacer/);
  assert.throws(() => vault.remove('id'), /remplacer/);
  assert.deepEqual(vault.login('id', origin), { username: 'alice', password: 'secret' });
  vault.lock();
});
