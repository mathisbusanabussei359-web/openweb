'use strict';

const api = window.openweb;
const $ = (id) => document.getElementById(id);
const address = $('address');
const names = {
  bookmarks: 'Favoris',
  history: 'Historique',
  home: 'Personnaliser l’accueil',
  downloads: 'Téléchargements',
  extensions: 'Extensions',
  reader: 'Mode lecture',
  settings: 'Paramètres',
  vault: 'Coffre de mots de passe',
};
let state;
let tabKey;
let panelKey;
let homeKey;
const engines = {
  duckduckgo: 'DuckDuckGo', brave: 'Brave Search', bing: 'Bing', startpage: 'Startpage',
  ecosia: 'Ecosia', qwant: 'Qwant', google: 'Google', firefox: 'Firefox',
};
const modules = {
  quick: 'Accès rapides', favorites: 'Favoris', frequent: 'Sites les plus consultés',
  recent: 'Pages récentes', shortcuts: 'Mes raccourcis',
};
let editing;
let noticeTimer;
let addressDirty = false;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(text, handler, className = 'quiet') {
  const node = el('button', className, text);
  node.type = 'button';
  node.addEventListener('click', handler);
  return node;
}

function notice(text) {
  const area = $('notice');
  area.hidden = false;
  area.textContent = text;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { area.hidden = true; }, 3800);
}

async function action(name, parameters) {
  try {
    const response = await api.action(name, parameters);
    if (response.error) {
      notice(response.error);
      return false;
    }
    render(response.state);
    return true;
  } catch {
    notice('OpenWeb n’a pas pu effectuer cette action.');
    return false;
  }
}

function panel(name) {
  return action('panel', { name });
}

function row(title, subtitle, controls, tag = 'div') {
  const node = el(tag, 'row');
  const copy = el('div', 'row-copy');
  copy.append(typeof title === 'string' ? el('p', 'row-title', title) : title);
  if (subtitle) copy.append(el('p', 'muted', subtitle));
  node.append(copy);
  if (controls?.length) {
    const wrapper = el('div', 'actions');
    wrapper.append(...controls);
    node.append(wrapper);
  }
  return node;
}

function card(title) {
  const node = el('div', 'card');
  if (title) node.append(el('h2', 'card-title', title));
  return node;
}

function toolbar(next) {
  const active = next.active;
  const tor = $('private-label');
  tor.hidden = !next.privateMode;
  tor.textContent = next.torStatus === 'ready' ? 'Tor connecté' : next.torStatus === 'checking' ? 'Tor en cours…' : 'Vérifier Tor';
  tor.disabled = next.torStatus !== 'offline';
  tor.title = next.torMessage;
  $('store-install').hidden = !next.storeListing;
  $('back').disabled = !active.back;
  $('forward').disabled = !active.forward;
  $('reload').disabled = !active.url;
  const reload = active.loading ? 'Arrêter le chargement' : 'Recharger';
  $('reload').textContent = active.loading ? '×' : '↻';
  $('reload').setAttribute('aria-label', reload);
  $('reload').title = reload;
  const isWeb = /^https?:/.test(active.url);
  $('bookmark-toggle').disabled = !active.committed || !isWeb;
  $('bookmark-toggle').textContent = next.marked ? '★' : '☆';
  $('bookmark-toggle').setAttribute('aria-pressed', String(next.marked));
  const mark = next.marked ? 'Retirer des favoris' : 'Ajouter aux favoris';
  $('bookmark-toggle').setAttribute('aria-label', mark);
  $('bookmark-toggle').title = mark;
  const badge = $('protocol');
  badge.hidden = !active.committed || !isWeb;
  const insecure = active.url.startsWith('http:');
  badge.textContent = insecure ? 'HTTP' : 'HTTPS';
  badge.classList.toggle('insecure', insecure);
  badge.title = insecure ? 'Connexion non chiffrée' : 'Connexion HTTPS';
  const blocked = $('blocked');
  blocked.hidden = !next.blocking || !active.blocked;
  blocked.textContent = String(active.blocked);
  const protection = next.blocking ? `${active.blocked} requête(s) bloquée(s)` : 'Blocage désactivé';
  $('shield').title = protection;
  $('shield').setAttribute('aria-label', `Protection · ${protection}`);
  $('shield').disabled = next.privateMode;
  document.querySelectorAll('.toolbar [data-panel]').forEach((node) => {
    if (node.id !== 'shield' || !next.privateMode) node.setAttribute('aria-pressed', String(node.dataset.panel === next.panel));
  });
  if (!addressDirty || state?.active.id !== active.id) {
    addressDirty = false;
    address.value = active.url || '';
  }
}

function tabs(next) {
  const signature = JSON.stringify([next.active.id, next.tabs.map(({ id, title }) => [id, title])]);
  if (signature === tabKey) return;
  const strip = $('tabs');
  const oldScroll = strip.scrollLeft;
  const focusId = strip.contains(document.activeElement) ? document.activeElement.dataset.tab : null;
  tabKey = signature;
  strip.replaceChildren();
  let selected;
  for (const tab of next.tabs) {
    const item = el('div', 'tab');
    const select = button('', () => action('tab:select', { id: tab.id }), 'tab-select');
    select.dataset.tab = tab.id;
    select.setAttribute('role', 'tab');
    select.setAttribute('aria-selected', String(tab.id === next.active.id));
    select.setAttribute('aria-controls', 'workspace');
    select.title = tab.title;
    const dot = el('span', 'tab-dot');
    dot.setAttribute('aria-hidden', 'true');
    select.append(dot, el('span', 'tab-name', tab.title));
    const close = button('×', () => action('tab:close', { id: tab.id }), 'tab-close');
    close.setAttribute('aria-label', `Fermer ${tab.title}`);
    item.append(select, close);
    strip.append(item);
    if (tab.id === next.active.id) selected = item;
    if (tab.id === focusId) select.focus({ preventScroll: true });
  }
  strip.scrollLeft = oldScroll;
  selected?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function links(name, items) {
  const list = card();
  if (!items.length) list.append(el('p', 'empty', name === 'history' ? 'Aucune page dans l’historique.' : 'Aucun favori enregistré.'));
  if (name === 'history' && items.length) {
    const clear = button('Effacer l’historique', () => {
      clear.textContent = 'Confirmer l’effacement';
      clear.onclick = () => action('history:clear');
    }, 'quiet danger');
    list.append(row('Pages visitées', '', [clear]));
  }
  for (const item of items) {
    const open = button(item.title || item.url, () => action('navigate:link', { url: item.url }), 'label-link');
    const date = item.date ? new Date(item.date).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '';
    const controls = name === 'bookmarks' ? [button('Retirer', () => action('bookmark:remove', { url: item.url }))] : [];
    list.append(row(open, [item.url, date].filter(Boolean).join(' · '), controls));
  }
  return [list];
}

function settingCheckbox(next, key, label, description) {
  const checkbox = el('input');
  checkbox.type = 'checkbox';
  checkbox.checked = next.settings[key];
  checkbox.addEventListener('change', async () => {
    if (!await action('setting', { name: key, value: checkbox.checked })) checkbox.checked = !checkbox.checked;
  });
  return row(label, description, [checkbox], 'label');
}

function engineChoice(next, key, privateMode) {
  const search = el('select');
  for (const [value, label] of Object.entries(engines)) {
    if (privateMode && ['google', 'firefox'].includes(value)) continue;
    const option = el('option', '', value === 'firefox' ? 'Firefox · moteur par défaut' : label);
    option.value = value;
    search.append(option);
  }
  search.value = next.settings[key];
  search.addEventListener('change', () => action('setting', { name: key, value: search.value }));
  return search;
}

function settings(next) {
  const search = card('Recherche et Tor');
  search.append(row('Moteur de recherche', 'Firefox ouvre la recherche dans Firefox avec son moteur configuré.', [
    engineChoice(next, 'search', false),
  ], 'label'));
  search.append(row('Moteur en navigation privée', 'La recherche passe par la connexion Tor vérifiée.', [
    engineChoice(next, 'privateSearch', true),
  ], 'label'));
  const torForm = el('form', 'actions');
  const port = el('input', 'port');
  Object.assign(port, { type: 'number', min: '0', max: '65535', value: next.settings.torPort || '', placeholder: 'Auto' });
  port.setAttribute('aria-label', 'Port SOCKS5 local ou automatique');
  const savePort = el('button', 'quiet', 'Appliquer');
  savePort.type = 'submit';
  torForm.append(port, savePort);
  torForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const value = port.value === '' ? 0 : Number(port.value);
    if (value !== 0 && value < 1024) return notice('Choisis un port de 1024 à 65535 ou laisse le champ vide.');
    void action('setting', { name: 'torPort', value });
  });
  search.append(row('Port SOCKS5 local', 'Auto essaie 9050, puis 9150. Ouvre une nouvelle fenêtre privée après modification.', [torForm]));

  const protection = card('Confidentialité');
  const preferences = [
    ['blocking', 'Bloquer les pubs et les pisteurs', `Filtrage des requêtes réseau · ${next.filterStatus}`],
    ['thirdPartyCookies', 'Filtrer les cookies tiers sur le réseau', 'Retire les en-têtes de cookies des requêtes et réponses des ressources tierces.'],
    ['stripTracking', 'Nettoyer les liens de suivi', 'Retire les paramètres publicitaires courants des adresses visitées.'],
    ['blockPings', 'Bloquer les pings de suivi', 'Bloque les notifications envoyées via les attributs de suivi des liens.'],
    ['doNotTrack', 'Demander aux sites de limiter le suivi', 'Envoie les signaux DNT et Global Privacy Control.'],
    ['httpsFirst', 'Préférer HTTPS à la saisie', 'Appliqué aux adresses saisies sans protocole.'],
    ['httpsOnly', 'HTTPS uniquement', 'Bloque la navigation principale vers les adresses HTTP.'],
  ];
  protection.append(...preferences.map(([key, label, description]) => settingCheckbox(next, key, label, description)));
  const refresh = button('Actualiser', async () => {
    refresh.disabled = true;
    if (await action('filters:refresh')) notice('Listes de filtrage actualisées.');
    refresh.disabled = false;
  });
  protection.append(row('Listes de filtrage', 'EasyList et EasyPrivacy', [refresh]));

  const navigation = card('Accueil et navigation');
  navigation.append(
    settingCheckbox(next, 'keepHistory', 'Conserver l’historique', 'Alimente les pages récentes et les sites les plus consultés.'),
    settingCheckbox(next, 'restoreTabs', 'Rouvrir les onglets au démarrage', 'Applicable à la fenêtre normale.'),
    settingCheckbox(next, 'dark', 'Thème sombre', 'Appliqué à l’interface OpenWeb.'),
    row('Nouvel onglet', 'Active, réorganise et configure les modules.', [button('Personnaliser', () => panel('home'))]),
    row('Zoom de la page', `${Math.round(next.active.zoom * 100)} %`, [
      button('− 10 %', () => action('zoom', { value: -0.1 })),
      button('100 %', () => action('zoom', { value: 0 })),
      button('+ 10 %', () => action('zoom', { value: 0.1 })),
    ]),
  );

  const data = card('Données et outils');
  data.append(
    row('Historique', '', [button('Afficher l’historique', () => panel('history'))]),
    row('Données locales', '', [
      button('Effacer le cache', () => action('privacy:clear', { kind: 'cache' })),
      button('Effacer les données des sites', () => action('privacy:clear', { kind: 'sites' }), 'quiet danger'),
    ]),
    row('Navigation', '', [button('Extensions', () => panel('extensions')), button('Fenêtre privée', () => action('private'))]),
  );
  return [search, protection, navigation, data];
}

function extensions(next) {
  const store = card('Chrome Web Store');
  const form = el('form', 'store-form');
  const link = field(form, 'Lien ou identifiant de l’extension', 'store', {
    type: 'text', required: true, maxLength: 2048, placeholder: 'https://chromewebstore.google.com/detail/…', spellcheck: false,
  });
  const install = el('button', 'primary', 'Installer');
  install.type = 'submit';
  form.append(install);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    install.disabled = true;
    install.textContent = 'Vérification…';
    await action('extensions:store', { value: link.value });
    install.disabled = false;
    install.textContent = 'Installer';
  });
  store.append(row('Parcourir le Chrome Web Store', 'Sur une fiche, utilise le bouton Installer de la barre OpenWeb.', [
    button('Ouvrir le Store', () => action('extensions:store-page')),
  ]), form);
  const tools = card();
  tools.append(row('Importer un dossier', 'Choisis le dossier décompressé qui contient manifest.json.', [
    button('Choisir un dossier', () => action('extensions:add')),
  ]));
  const list = card('Extensions installées');
  if (!next.extensions.length) list.append(el('p', 'empty', 'Aucune extension installée.'));
  for (const entry of next.extensions) {
    const controls = [];
    if (entry.page) controls.push(button('Ouvrir', () => action('extensions:open', { key: entry.key })));
    if (entry.storeId) controls.push(button('Mettre à jour', async (event) => {
      const update = event.currentTarget;
      update.disabled = true;
      if (await action('extensions:update', { key: entry.key })) notice('Vérification de mise à jour terminée.');
      update.disabled = false;
    }));
    controls.push(button(entry.enabled && !entry.error ? 'Désactiver' : 'Activer',
      () => action('extensions:set', { key: entry.key, value: !entry.enabled || Boolean(entry.error) })));
    controls.push(button('Supprimer', () => action('extensions:set', { key: entry.key, value: null }), 'quiet danger'));
    const source = entry.storeId ? 'Chrome Web Store' : 'Dossier local';
    list.append(row(entry.name, [entry.version, source, entry.error || (entry.enabled ? 'Activée' : 'Désactivée')].join(' · '), controls));
  }
  return [store, tools, list];
}

function editHome(next) {
  const layout = card('Modules du nouvel onglet');
  const active = next.homeModules;
  const order = [...active, ...Object.keys(modules).filter((id) => !active.includes(id))];
  for (const id of order) {
    const position = active.indexOf(id);
    const selected = position >= 0;
    const checkbox = el('input');
    checkbox.type = 'checkbox';
    checkbox.checked = selected;
    checkbox.setAttribute('aria-label', modules[id]);
    checkbox.addEventListener('change', async () => {
      if (!await action('home:module', { id, enabled: checkbox.checked })) checkbox.checked = selected;
    });
    const up = button('↑', () => action('home:module', { id, step: -1 }));
    up.setAttribute('aria-label', `Remonter ${modules[id]}`);
    up.disabled = position <= 0;
    const down = button('↓', () => action('home:module', { id, step: 1 }));
    down.setAttribute('aria-label', `Descendre ${modules[id]}`);
    down.disabled = !selected || position >= active.length - 1;
    layout.append(row(modules[id], '', [up, down, checkbox]));
  }

  const shortcuts = card('Mes raccourcis');
  const form = el('form', 'store-form shortcut-form');
  const title = field(form, 'Nom', 'title', { required: true, maxLength: 80 });
  const url = field(form, 'Adresse HTTP ou HTTPS', 'url', { type: 'url', required: true, maxLength: 8192, placeholder: 'https://example.org' });
  const submit = el('button', 'primary', 'Ajouter');
  submit.type = 'submit';
  form.append(submit);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    submit.disabled = true;
    if (await action('home:shortcut', { title: title.value, url: url.value })) form.reset();
    submit.disabled = false;
  });
  shortcuts.append(form);
  for (const item of next.shortcuts) {
    shortcuts.append(row(item.title, item.url, [button('Retirer', () => action('home:shortcut', { id: item.id, remove: true }))]));
  }
  return [layout, shortcuts];
}

function homeModules(next) {
  const signature = JSON.stringify([next.homeModules, next.bookmarks, next.frequent, next.recent, next.shortcuts]);
  if (homeKey === signature) return;
  homeKey = signature;
  const region = $('home-modules');
  region.replaceChildren();
  const lists = { favorites: next.bookmarks, frequent: next.frequent, recent: next.recent, shortcuts: next.shortcuts };
  for (const id of next.homeModules) {
    if (id === 'quick') {
      const quick = el('nav', 'quick');
      quick.setAttribute('aria-label', 'Accès rapides');
      quick.append(
        button('☆  Favoris', () => panel('bookmarks')),
        button('◷  Historique', () => panel('history')),
        button('⊞  Extensions', () => panel('extensions')),
        button('◐  Fenêtre privée', () => action('private')),
      );
      region.append(quick);
      continue;
    }
    if (!lists[id]?.length) continue;
    const shelf = el('section', 'home-shelf');
    shelf.append(el('h2', '', modules[id]));
    const grid = el('div', 'home-grid');
    for (const item of lists[id]) {
      const link = button('', () => action('navigate:link', { url: item.url }), 'home-tile');
      const url = new URL(item.url);
      link.title = item.url;
      link.append(el('span', 'tile-title', item.title || url.hostname));
      link.append(el('span', 'tile-meta', id === 'frequent' ? `${item.visits} visite${item.visits > 1 ? 's' : ''}` : url.hostname));
      grid.append(link);
    }
    shelf.append(grid);
    region.append(shelf);
  }
}

function downloads(next) {
  const list = card();
  const labels = { progress: 'En cours', progressing: 'En cours', completed: 'Terminé', interrupted: 'Interrompu', cancelled: 'Annulé' };
  if (!next.downloads.length) list.append(el('p', 'empty', 'Aucun téléchargement dans cette fenêtre.'));
  for (const item of next.downloads) {
    const controls = item.status === 'completed' ? [button('Afficher dans le dossier', () => action('download:show', { id: item.id }))]
      : ['progress', 'progressing'].includes(item.status) ? [button('Annuler', () => action('download:cancel', { id: item.id }))] : [];
    const itemRow = row(item.name, labels[item.status] ?? item.status, controls);
    if (['progress', 'progressing'].includes(item.status)) {
      const progress = el('progress');
      progress.setAttribute('aria-label', `Progression de ${item.name}`);
      if (item.total > 0) {
        progress.max = item.total;
        progress.value = item.received;
      }
      itemRow.firstChild.append(progress);
    }
    list.append(itemRow);
  }
  return [list];
}

function field(form, caption, name, attributes) {
  const label = el('label', 'field', caption);
  const input = el('input');
  input.name = name;
  Object.assign(input, attributes);
  label.append(input);
  form.append(label);
  return input;
}

function vault(next) {
  const current = next.vault;
  if (!current.unlocked) {
    editing = null;
    const container = el('div', 'card pad');
    container.append(el('h2', '', current.exists ? 'Coffre verrouillé' : 'Créer un coffre local'));
    const form = el('form', 'vault-form');
    form.autocomplete = 'off';
    const code = field(form, 'Code maître', 'master', {
      type: 'password', required: true, minLength: current.exists ? 1 : 12, maxLength: 256,
    });
    let confirmation;
    if (!current.exists) {
      container.append(el('p', 'muted', 'Choisis une phrase secrète d’au moins 12 caractères. Elle permet de déchiffrer ton coffre.'));
      confirmation = field(form, 'Confirmer le code maître', 'confirmation', { type: 'password', required: true, maxLength: 256 });
    }
    const submit = el('button', 'primary', current.exists ? 'Déverrouiller' : 'Créer le coffre');
    submit.type = 'submit';
    form.append(submit);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      submit.disabled = true;
      const parameters = { code: code.value, confirmation: confirmation?.value };
      form.reset();
      await action('vault:unlock', parameters);
      submit.disabled = false;
    });
    container.append(form);
    return [container];
  }

  let origin = '';
  if (next.active.committed && next.active.url.startsWith('https:')) origin = new URL(next.active.url).origin;
  const controls = el('div', 'actions');
  controls.append(button('Ajouter un identifiant', () => {
    editing = { origin };
    drawPanel(state, true);
  }, 'primary'), button('Verrouiller', () => action('vault:lock')));
  const list = card('Identifiants enregistrés');
  if (!current.entries.length) list.append(el('p', 'empty', 'Aucun identifiant enregistré.'));
  for (const entry of current.entries) {
    const actions = [];
    if (entry.origin === origin) actions.push(button('Remplir', () => action('vault:fill', { id: entry.id }), 'secondary'));
    actions.push(button('Copier', () => action('vault:copy', { id: entry.id, origin: entry.origin })));
    actions.push(button('Modifier', () => { editing = entry; drawPanel(state, true); }));
    const remove = button('Supprimer', () => {
      remove.textContent = 'Confirmer la suppression';
      remove.onclick = () => action('vault:remove', { id: entry.id });
    }, 'quiet danger');
    actions.push(remove);
    list.append(row(entry.username || entry.origin, entry.username ? entry.origin : '', actions));
  }

  const intro = card();
  intro.append(row('Coffre déverrouillé', 'Verrouillage après cinq minutes sans activité dans le coffre.', [controls]));
  if (!editing) return [intro, list];

  const form = el('form', 'card pad');
  form.autocomplete = 'off';
  form.append(el('h2', '', editing.id ? 'Modifier un identifiant' : 'Nouvel identifiant'));
  const site = field(form, 'Adresse du site (HTTPS)', 'site', { type: 'url', required: true, maxLength: 8192, value: editing.origin || '', placeholder: 'https://example.org' });
  const username = field(form, 'Identifiant', 'username', { maxLength: 512, value: editing.username || '' });
  const password = field(form, 'Mot de passe', 'password', { type: 'password', required: true, maxLength: 4096 });
  const submit = el('button', 'primary', 'Enregistrer');
  submit.type = 'submit';
  const formButtons = el('div', 'actions');
  formButtons.append(button('Générer un mot de passe', () => {
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    password.value = btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_');
  }), button('Annuler', () => { editing = null; drawPanel(state, true); }), submit);
  form.append(formButtons);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    submit.disabled = true;
    if (await action('vault:put', { id: editing?.id, site: site.value, username: username.value, password: password.value })) {
      editing = null;
      drawPanel(state, true);
    }
    submit.disabled = false;
  });
  return [intro, form, list];
}

function reader(next) {
  const article = el('article', 'card reader');
  const text = next.reader;
  article.append(el('h2', '', text?.title || 'Extraction du texte…'));
  if (text?.blocks.length === 0) article.append(el('p', 'muted', 'Cette page ne contient pas assez de texte lisible.'));
  for (const block of text?.blocks ?? []) article.append(el(block.heading ? 'h2' : 'p', '', block.text));
  return [article];
}

function drawPanel(next, force = false) {
  const node = $('panel');
  const name = next.panel;
  node.hidden = !name;
  if (name !== 'vault') editing = null;
  const relevant = {
    bookmarks: next.bookmarks, history: next.history, downloads: next.downloads, extensions: next.extensions,
    home: [next.homeModules, next.shortcuts], reader: next.reader, settings: [next.settings, next.filterStatus, next.active.zoom], vault: [next.vault, next.active.url],
  };
  const signature = JSON.stringify([name, relevant[name]]);
  if (signature === panelKey && !force) return;
  if (state?.panel !== name) $('workspace').scrollTop = 0;
  panelKey = signature;
  node.replaceChildren();
  if (!name) return;
  const head = el('header', 'panel-head');
  const title = el('div');
  title.append(el('h1', '', names[name]));
  const close = button('Retour à l’onglet', () => panel(null));
  head.append(title, close);
  const contents = {
    bookmarks: () => links(name, next.bookmarks), history: () => links(name, next.history),
    downloads: () => downloads(next), extensions: () => extensions(next),
    settings: () => settings(next), vault: () => vault(next), reader: () => reader(next), home: () => editHome(next),
  };
  node.append(head, ...contents[name]());
}

function render(next) {
  if (!next?.active) return;
  document.documentElement.classList.toggle('dark', next.dark);
  document.documentElement.classList.toggle('private', next.privateMode);
  toolbar(next);
  tabs(next);
  $('home').hidden = Boolean(next.panel || !next.active.home);
  $('home-title').textContent = next.privateMode ? 'Navigation privée' : 'OpenWeb';
  const torPending = next.privateMode && next.torStatus !== 'ready';
  $('private-note').hidden = !next.privateMode;
  $('private-note').textContent = next.torStatus === 'checking' ? 'Vérification de Tor en cours…'
    : next.torMessage || 'Navigation et recherche via Tor.';
  $('tor-retry').hidden = next.torStatus !== 'offline';
  const query = $('query');
  query.disabled = torPending;
  $('home-search').querySelector('button').disabled = torPending;
  query.placeholder = torPending ? 'Connexion Tor requise' : `Rechercher avec ${engines[next.searchChoice] || 'DuckDuckGo'}`;
  $('error-page').hidden = Boolean(next.panel || !next.active.error);
  $('load-error').textContent = torPending ? next.torMessage : next.active.error || '';
  homeModules(next);
  drawPanel(next);
  state = next;
}

address.addEventListener('input', () => { addressDirty = true; });
address.addEventListener('blur', () => {
  if (!addressDirty) return;
  addressDirty = false;
  if (state) address.value = state.active.url;
});
$('address-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const value = address.value;
  addressDirty = false;
  address.blur();
  void action('navigate', { value });
});
$('home-search').addEventListener('submit', (event) => {
  event.preventDefault();
  const value = $('query').value;
  if (value.trim()) void action('navigate', { value });
});
for (const [id, name] of [
  ['new-tab', 'tab:new'], ['back', 'back'], ['forward', 'forward'], ['reload', 'reload'],
  ['bookmark-toggle', 'bookmark:toggle'], ['tor-retry', 'tor:retry'], ['private-label', 'tor:retry'],
]) $(id).addEventListener('click', () => action(name));
$('retry').addEventListener('click', async () => {
  if (state?.torStatus === 'offline') await action('tor:retry');
  if (!state?.privateMode || state.torStatus === 'ready') void action('reload');
});
$('store-install').addEventListener('click', async () => {
  const install = $('store-install');
  install.disabled = true;
  await action('extensions:store');
  install.disabled = false;
});
document.querySelectorAll('[data-panel]').forEach((node) => node.addEventListener('click', () => panel(node.dataset.panel)));
api.onState(render);
api.onNotice(notice);
api.onAddress(() => { address.focus(); address.select(); });
void action('state');
