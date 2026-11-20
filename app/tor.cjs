const CHECK = 'https://check.torproject.org/api/ip';

async function connectTor(context, port) {
  const proxy = `127.0.0.1:${port}`;
  await context.setProxy({
    mode: 'fixed_servers',
    proxyRules: `socks5://${proxy}`,
    proxyBypassRules: '<-loopback>',
  });
  await context.closeAllConnections();
  if ((await context.resolveProxy(CHECK)) !== `SOCKS5 ${proxy}`) {
    throw new Error('Le proxy Tor n’est pas actif dans cette fenêtre.');
  }
  try {
    const response = await context.fetch(CHECK, {
      credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(18_000),
    });
    if (response.ok && (await response.json()).IsTor === true) return;
  } catch {
    // Navigation remains unavailable until Tor can be confirmed.
  }
  throw new Error(`Connexion Tor non confirmée. Démarre Tor ou le Navigateur Tor et vérifie le port SOCKS5 ${port}.`);
}

module.exports = { connectTor };
