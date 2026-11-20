const assert = require('node:assert/strict');
const { test } = require('node:test');
const { address, loginOrigin, webUrl } = require('../app/navigation.cjs');

test('addresses default to HTTPS, preserve explicit HTTP and support local servers', () => {
  const settings = { httpsFirst: true, search: 'duckduckgo' };
  assert.equal(address(' example.org/a?b=2 ', settings), 'https://example.org/a?b=2');
  assert.equal(address('localhost:3000/test', { ...settings, httpsFirst: false }), 'http://localhost:3000/test');
  assert.equal(address('http://localhost:3000/test', settings), 'http://localhost:3000/test');
  assert.equal(address('[::1]:3000/test', settings), 'https://[::1]:3000/test');
  assert.equal(address('météo Paris', settings), 'https://duckduckgo.com/?q=m%C3%A9t%C3%A9o%20Paris');
});

test('untrusted protocols, credentials and embedded control characters cannot be opened', () => {
  const settings = { httpsFirst: true, search: 'duckduckgo' };
  for (const url of ['javascript:alert(1)', 'file:///tmp/test', 'data:text/html,text', 'https://user@host.example', 'https://exa\tmple.org']) {
    assert.equal(webUrl(url), null);
    assert.throws(() => address(url, settings));
  }
});

test('saved logins use exact HTTPS origins including non-default port', () => {
  assert.equal(loginOrigin('https://EXAMPLE.org:443/login?x=1'), 'https://example.org');
  assert.equal(loginOrigin('https://example.org:4001/login'), 'https://example.org:4001');
  assert.throws(() => loginOrigin('http://example.org/login'));
  assert.throws(() => loginOrigin('https://user@example.org/login'));
});
