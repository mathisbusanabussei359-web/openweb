const SEARCH = {
  duckduckgo: 'https://duckduckgo.com/?q=',
  qwant: 'https://www.qwant.com/?q=',
  google: 'https://www.google.com/search?q=',
  brave: 'https://search.brave.com/search?q=',
  bing: 'https://www.bing.com/search?q=',
  startpage: 'https://www.startpage.com/sp/search?query=',
  ecosia: 'https://www.ecosia.org/search?q=',
};

function webUrl(value) {
  if (typeof value !== 'string' || /[\u0000-\u0020\u007f]/u.test(value)) return null;
  try {
    const url = new URL(value);
    if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) return url;
  } catch {
    return null;
  }
  return null;
}

function address(input, options) {
  const value = typeof input === 'string' ? input.trim() : '';
  if (!value || value.length > 8192 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error('Saisis une adresse ou une recherche valide.');
  }
  const hostWithPort = /^(?:localhost|[^\s/:]+\.[^\s/:]+|\[[a-f\d:]+\]):\d+(?:[/?#]|$)/i.test(value);
  if (!hostWithPort && /^[a-z][a-z\d+.-]*:/i.test(value)) {
    const url = webUrl(value);
    if (!url) throw new Error('Seules les adresses HTTP et HTTPS sans identifiants sont acceptées.');
    return url.href;
  }

  if (hostWithPort || /^(?:localhost|[^\s/:@]+\.[^\s/:@]+|\[[a-f\d:]+\])(?:[/?#]|$)/i.test(value)) {
    const url = webUrl(`${options.httpsFirst ? 'https' : 'http'}://${value}`);
    if (url) return url.href;
  }
  if (options.search === 'firefox') return { firefoxQuery: value };
  return (SEARCH[options.search] ?? SEARCH.duckduckgo) + encodeURIComponent(value);
}

function loginOrigin(input) {
  const url = webUrl(input);
  if (url?.protocol !== 'https:') throw new Error('Le coffre utilise une adresse HTTPS complète.');
  return url.origin;
}

function isolated(contents, fn, ...args) {
  const code = `(${fn.toString()})(...${JSON.stringify(args)})`;
  return contents.executeJavaScriptInIsolatedWorld(1101, [{ code }]);
}

function fillLogin(origin, { username, password }) {
  if (!isSecureContext || location.origin !== origin || window !== window.top) return false;
  const visible = (field) => !field.disabled && !field.readOnly && field.getClientRects().length
    && getComputedStyle(field).visibility === 'visible';
  const fields = [...document.querySelectorAll('input[type="password"]')].filter(visible);
  if (fields.length !== 1) return false;
  const secret = fields[0];
  const form = secret.form;
  if (!form || secret.autocomplete === 'new-password' || new URL(form.action).origin !== origin) return false;
  const candidates = [...form.elements].filter((field) => field instanceof HTMLInputElement
    && ['text', 'email', 'tel'].includes(field.type) && visible(field));
  const identity = candidates.find((field) => field.autocomplete === 'username')
    ?? candidates.find((field) => field.type === 'email')
    ?? (candidates.length === 1 ? candidates[0] : null);
  if (username && !identity) return false;
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  if (identity) setValue.call(identity, username);
  setValue.call(secret, password);
  for (const field of [identity, secret]) {
    if (!field) continue;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  }
  return true;
}

function extractArticle(origin) {
  if (location.origin !== origin) return null;
  const root = document.querySelector('article') ?? document.querySelector('main, [role=main]') ?? document.body;
  if (!root) return null;
  const blocks = [];
  let size = 0;
  for (const element of root.querySelectorAll('h1,h2,h3,p,blockquote,li,pre')) {
    if (element.closest('nav,aside,footer,form,[aria-hidden=true]') || !element.getClientRects().length) continue;
    if (element.closest('blockquote,li') !== null && !['BLOCKQUOTE', 'LI'].includes(element.tagName)) continue;
    const text = element.textContent.trim().slice(0, 6000);
    if (!text) continue;
    blocks.push({ heading: /^H[1-3]$/.test(element.tagName), text });
    size += text.length;
    if (blocks.length >= 200 || size > 100_000) break;
  }
  if (size < 100) return null;
  return { title: document.title.slice(0, 200), blocks };
}

module.exports = { SEARCH, address, webUrl, loginOrigin, isolated, fillLogin, extractArticle };
