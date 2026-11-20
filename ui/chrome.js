'use strict';

const api = window.openweb;
const $ = (id) => document.getElementById(id);
const address = $('address');
const names = {
  bookmarks: 'Favoris',
  history: 'Historique',
  downloads: 'Téléchargements',
  extensions: 'Extensions',
  reader: 'Mode lecture',
  settings: 'Paramètres',
  vault: 'Coffre de mots de passe',
};
let state;
let tabKey;
let panelKey;
let bookmarkKey;
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
  $('private-label').hidden = !next.privateMode;
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

function settings(next) {
  const options = card('Confidentialité et navigation');
  const preferences = [
    ['blocking', 'Bloquer les pubs et les pisteurs', `Filtrage des requêtes réseau · ${next.filterStatus}`],
    ['doNotTrack', 'Demander aux sites de limiter le suivi', 'Envoie les signaux DNT et Global Privacy Control. Leur respect dépend du site.'],
    ['httpsFirst', 'Préférer HTTPS dans la barre d’adresse', 'Appliqué aux adresses saisies sans protocole.'],
    ['restoreTabs', 'Rouvrir les onglets au démarrage', 'Applicable à la fenêtre normale.'],
    ['dark', 'Thème sombre', 'Appliqué à l’interface OpenWeb.'],
  ];
  for (const [key, label, description] of preferences) {
    const checkbox = el('input');
    checkbox.type = 'checkbox';
    checkbox.checked = next.settings[key];
    checkbox.addEventListener('change', async () => {
      if (!await action('setting', { name: key, value: checkbox.checked })) checkbox.checked = !checkbox.checked;
    });
    options.append(row(label, description, [checkbox], 'label'));
  }

  const search = el('select');
  for (const [value, label] of [['duckduckgo', 'DuckDuckGo'], ['qwant', 'Qwant'], ['google', 'Google']]) {
    const option = el('option', '', label);
    option.value = value;
    search.append(option);
  }
  search.value = next.settings.search;
  search.addEventListener('change', () => action('setting', { name: 'search', value: search.value }));
  options.append(row('Moteur de recherche', '', [search], 'label'));

  const more = card('Outils');
  const refresh = button('Actualiser', async () => {
    refresh.disabled = true;
    if (await action('filters:refresh')) notice('Listes de filtrage actualisées.');
    refresh.disabled = false;
  });
  more.append(row('Listes de filtrage', 'EasyList et EasyPrivacy', [refresh]));
  const zoom = (value) => action('zoom', { value });
  more.append(row('Zoom de la page', `${Math.round(next.active.zoom * 100)} %`, [
    button('− 10 %', () => zoom(-0.1)), button('100 %', () => zoom(0)), button('+ 10 %', () => zoom(0.1)),
  ]));
  more.append(row('Navigation', '', [
    button('Historique', () => panel('history')),
    button('Extensions', () => panel('extensions')),
    button('Fenêtre privée', () => action('private')),
  ]));
  return [options, more];
}

function extensions(next) {
  const tools = card();
  tools.append(row('Importer une extension Chromium', 'Choisis le dossier décompressé qui contient manifest.json.', [
    button('Choisir un dossier', () => action('extensions:add'), 'primary'),
  ]));
  const list = card('Extensions installées');
  if (!next.extensions.length) list.append(el('p', 'empty', 'Aucune extension installée.'));
  for (const entry of next.extensions) {
    const controls = [];
    if (entry.page) controls.push(button('Ouvrir', () => action('extensions:open', { key: entry.key })));
    controls.push(button(entry.enabled && !entry.error ? 'Désactiver' : 'Activer',
      () => action('extensions:set', { key: entry.key, value: !entry.enabled || Boolean(entry.error) })));
    controls.push(button('Supprimer', () => action('extensions:set', { key: entry.key, value: null }), 'quiet danger'));
    list.append(row(entry.name, [entry.version, entry.error || (entry.enabled ? 'Activée' : 'Désactivée')].filter(Boolean).join(' · '), controls));
  }
  return [tools, list];
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
    reader: next.reader, settings: [next.settings, next.filterStatus, next.active.zoom], vault: [next.vault, next.active.url],
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
  if (name === 'extensions') title.append(el('p', 'muted', 'Les extensions décompressées compatibles peuvent être installées ici.'));
  const close = button('Retour à l’onglet', () => panel(null));
  head.append(title, close);
  const contents = {
    bookmarks: () => links(name, next.bookmarks), history: () => links(name, next.history),
    downloads: () => downloads(next), extensions: () => extensions(next),
    settings: () => settings(next), vault: () => vault(next), reader: () => reader(next),
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
  $('private-note').hidden = !next.privateMode;
  $('error-page').hidden = Boolean(next.panel || !next.active.error);
  $('load-error').textContent = next.active.error || '';
  const saved = next.active.home && !next.panel ? next.bookmarks.slice(0, 8) : [];
  const signature = JSON.stringify(saved);
  if (bookmarkKey !== signature) {
    bookmarkKey = signature;
    $('home-bookmarks').replaceChildren(...saved.map((item) =>
      button(item.title || item.url, () => action('navigate:link', { url: item.url }))));
  }
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
  ['retry', 'reload'], ['bookmark-toggle', 'bookmark:toggle'], ['private-window', 'private'],
]) $(id).addEventListener('click', () => action(name));
document.querySelectorAll('[data-panel]').forEach((node) => node.addEventListener('click', () => panel(node.dataset.panel)));
api.onState(render);
api.onNotice(notice);
api.onAddress(() => { address.focus(); address.select(); });
void action('state');
