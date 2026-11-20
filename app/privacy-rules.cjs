const { getDomain } = require('tldts');

const TRACKERS = new Set(['fbclid', 'gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid', 'msclkid', 'ttclid',
  'twclid', 'igshid', 'mc_cid', 'mc_eid', 'yclid', '_hsenc', '_hsmi', 'mkt_tok']);

function stripTracking(url) {
  // Preserve byte-for-byte encoding of other parameters and skip signed or auth URLs.
  const query = url.indexOf('?');
  const hash = url.indexOf('#');
  if (query < 0 || (hash >= 0 && hash < query)) return url;
  const suffix = hash < 0 ? '' : url.slice(hash);
  const pairs = url.slice(query + 1, hash < 0 ? undefined : hash).split('&');
  const named = pairs.map((pair) => {
    try {
      return decodeURIComponent(pair.split('=', 1)[0]).toLowerCase();
    } catch {
      return '';
    }
  });
  if (named.some((name) => /^(?:x-amz-|x-goog-|signature$|sig$|hmac$|token$|code$|state$|oauth_|saml|relaystate$)/u.test(name))) {
    return url;
  }
  const cleaned = pairs.filter((_pair, index) => !named[index].startsWith('utm_') && !TRACKERS.has(named[index]));
  if (cleaned.length === pairs.length) return url;
  return url.slice(0, query) + (cleaned.length ? '?' + cleaned.join('&') : '') + suffix;
}

function site(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) return null;
    const domain = getDomain(url.hostname, { allowPrivateDomains: true }) ?? url.hostname;
    return `${['https:', 'wss:'].includes(url.protocol) ? 'https' : 'http'}://${domain}`;
  } catch {
    return null;
  }
}

function thirdPartyResource(details, tab) {
  if (details.resourceType === 'mainFrame') return false;
  const top = site(tab?.pending || tab?.url || details.initiatorOrigin || details.referrer);
  const request = site(details.url);
  return Boolean(request && top !== request);
}

function removeHeaders(headers, ...names) {
  for (const name of Object.keys(headers)) {
    if (names.includes(name.toLowerCase())) delete headers[name];
  }
}

module.exports = { stripTracking, thirdPartyResource, removeHeaders };
