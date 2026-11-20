const { Parser } = require('htmlparser2');
const { webUrl } = require('./navigation.cjs');

const MAX_BOOKMARKS = 1000;
const MAX_IMPORT_SIZE = 5 * 1024 * 1024;

function parseBookmarks(html) {
  const entries = new Map();
  let url = null;
  let title = '';
  const parser = new Parser({
    onopentag(name, attributes) {
      if (name !== 'a') return;
      url = webUrl(attributes.href);
      title = '';
    },
    ontext(text) {
      if (url && title.length < 240) title += text.slice(0, 240 - title.length);
    },
    onclosetag(name) {
      if (name !== 'a') return;
      if (url && entries.size < MAX_BOOKMARKS && url.href.length <= 8192 && !entries.has(url.href)) {
        entries.set(url.href, { title: title.trim() || url.hostname, url: url.href });
      }
      url = null;
    },
  });
  parser.end(html);
  return [...entries.values()];
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/gu, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function exportBookmarks(entries) {
  const lines = [
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    '<TITLE>Favoris OpenWeb</TITLE>',
    '<H1>Favoris OpenWeb</H1>',
    '<DL><p>',
  ];
  for (const entry of entries) {
    const url = webUrl(entry.url);
    if (url) lines.push(`    <DT><A HREF="${escapeHtml(url.href)}">${escapeHtml(entry.title || url.hostname)}</A>`);
  }
  return [...lines, '</DL><p>', ''].join('\n');
}

module.exports = { parseBookmarks, exportBookmarks, MAX_BOOKMARKS, MAX_IMPORT_SIZE };
