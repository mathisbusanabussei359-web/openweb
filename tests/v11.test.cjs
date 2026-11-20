const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { parseBookmarks, exportBookmarks } = require('../app/bookmarks.cjs');
const { Profile } = require('../app/profile.cjs');

test('bookmark HTML interoperates with Netscape bookmark exports and admits web URLs only', () => {
  const source = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
    <DL><p><DT><H3>Dossier</H3><DL><p>
    <DT><A HREF="https://example.org/?a=1&amp;b=2">À lire &amp; <b>garder</b></A>
    <DT><A HREF="https://example.org/?a=1&amp;b=2">Doublon</A>
    <DT><A HREF="http://127.0.0.1:4000/">Serveur local</A>
    <DT><A HREF="file:///notes">Local</A>
    <DT><A HREF="javascript:void(0)">Action</A>
    </DL></DL>`;
  const expected = [
    { url: 'https://example.org/?a=1&b=2', title: 'À lire & garder' },
    { url: 'http://127.0.0.1:4000/', title: 'Serveur local' },
  ];
  assert.deepEqual(parseBookmarks(source), expected);
  const exported = exportBookmarks([...expected, { url: 'https://example.net/', title: '<b>&" exemple' }]);
  assert.match(exported, /&lt;b&gt;&amp;&quot; exemple/);
  assert.deepEqual(parseBookmarks(exported).slice(0, 2), expected);
});

test('profile migration reads old tabs and preserves pinned tabs, audio and local download history', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'openweb-profile-v11-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const inferredDownload = path.join(directory, 'document.pdf');
  await fs.writeFile(path.join(directory, 'openweb.json'), JSON.stringify({
    tabs: ['https://example.org/', ''],
  }));
  const profile = new Profile(directory);
  assert.deepEqual(profile.data.tabs, [
    { url: 'https://example.org/', pinned: false, muted: false }, { url: '', pinned: false, muted: false },
  ]);
  profile.commit({
    tabs: [{ url: 'https://example.org/', pinned: true, muted: true }],
    downloads: [{ id: 'test', name: 'document.pdf', status: 'completed', path: inferredDownload }],
  });
  const restored = new Profile(directory);
  assert.deepEqual(restored.data.tabs, [{ url: 'https://example.org/', pinned: true, muted: true }]);
  assert.equal(restored.data.downloads[0].path, inferredDownload);
  assert.equal(restored.data.settings.animations, true);
});
