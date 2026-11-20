# OpenWeb

OpenWeb 1.0 est un navigateur de bureau en français. Chromium affiche les sites dans des processus isolés. Un module Rust assure le filtrage réseau et le chiffrement du coffre.

## Démarrer

Installe [Node.js](https://nodejs.org/) 22.12 ou plus récent et [Rust](https://www.rust-lang.org/tools/install) stable (1.100 ou plus récent). Sous Windows, installe aussi les outils C++ de Visual Studio. Sous Linux, il faut les bibliothèques de bureau requises par Chromium, dont GTK 3 et NSS, et un système compatible avec le bac à sable Chromium.

```sh
git clone https://github.com/mathisbusanabussei359-web/openweb.git
cd openweb
npm ci
npm run build
npm start
```

`npm run package` crée une application portable dans `dist/` pour le système et l’architecture utilisés pour la compilation. Les archives de compilation sont aussi accessibles depuis les exécutions réussies dans [GitHub Actions](https://github.com/mathisbusanabussei359-web/openweb/actions). Les builds sont sans signature de distribution ni mise à jour automatique.

Lance `OpenWeb.exe` sous Windows, `OpenWeb.app` sous macOS ou `./OpenWeb` depuis le dossier extrait sous Linux. Le lanceur Linux utilise le bac à sable Chromium fondé sur les espaces de noms utilisateur lorsque l’assistant setuid est indisponible. Sur une distribution qui restreint les espaces de noms pour les applications de bureau, l’assistant Chromium livré dans le paquet doit appartenir à `root:root` et être installé en mode `4755` par l’administrateur.

## Accueil et recherche

- Dans un nouvel onglet, clique sur **Personnaliser l’accueil** pour activer et réordonner les accès rapides, les favoris, les sites les plus consultés, les pages récentes et tes raccourcis. Les sites les plus consultés sont calculés localement à partir de l’historique du profil normal.
- Dans **Paramètres**, choisis DuckDuckGo, Brave Search, Bing, Startpage, Ecosia, Qwant ou Google. L’option Firefox transmet la recherche à Firefox installé sur l’ordinateur, qui utilise son moteur par défaut. Le moteur en navigation privée se règle séparément.
- OpenWeb propose les onglets, les favoris, l’historique, les téléchargements, le zoom et le mode lecture. Les raccourcis `Ctrl/Cmd+L`, `Ctrl/Cmd+T`, `Ctrl/Cmd+Maj+T` et `Ctrl/Cmd+Maj+N` ouvrent respectivement l’adresse, un onglet, le dernier onglet fermé et une fenêtre privée.

## Navigation privée via Tor

1. Lance Tor sur ton ordinateur. Le mode automatique essaie le port SOCKS5 `9050` de Tor, puis le port `9150` généralement utilisé quand le Navigateur Tor est ouvert et connecté. Le réglage **Port SOCKS5 local** permet de choisir un autre port. [Télécharger Tor Browser](https://www.torproject.org/fr/download/)
2. Ouvre une fenêtre privée dans OpenWeb. Chaque fenêtre utilise une session en mémoire avec son propre proxy SOCKS5, sans itinéraire de secours direct. OpenWeb envoie une requête de vérification via cette session à `check.torproject.org` avant d’autoriser la recherche ou l’ouverture d’une page.
3. Si la vérification échoue, lance ou reconnecte Tor et clique sur **Vérifier Tor**. Si tu modifies le port, ouvre une nouvelle fenêtre privée.

Les cookies, l’historique et les extensions du profil normal restent séparés. OpenWeb utilise Chromium dans la fenêtre privée. Tor Browser propose ses propres protections contre l’empreinte du navigateur.

## Confidentialité

- Les réglages couvrent le filtrage EasyList et EasyPrivacy, le nettoyage des paramètres de suivi courants, le blocage des pings de suivi, le retrait des en-têtes de cookies tiers et les signaux DNT et Global Privacy Control.
- Le filtre de cookies agit sur les en-têtes réseau des ressources tierces. Le stockage auquel une page accède via JavaScript relève des règles de Chromium. Le nettoyage des liens conserve les paramètres d’authentification ou de signature reconnus.
- Tu peux limiter les pages principales à HTTPS, désactiver l’enregistrement de l’historique et effacer le cache ou les données des sites depuis les paramètres.
- OpenWeb désactive le correcteur orthographique intégré, les rapports de plantage et plusieurs services Chromium susceptibles de communiquer en arrière-plan. La recherche par défaut est DuckDuckGo. Ouvrir un site Google, choisir son moteur ou demander une extension du Chrome Web Store implique de communiquer avec Google pour cette action.
- EasyList et EasyPrivacy sont récupérées auprès d’EasyList. Les règles de base restent disponibles hors ligne. Les permissions comme la caméra, le micro et la localisation sont refusées par défaut.

## Coffre de mots de passe

Ouvre le cadenas dans la barre d’outils et crée un code maître d’au moins 12 caractères. Utilise de préférence une phrase secrète longue et unique. Le code est nécessaire pour déchiffrer le coffre et OpenWeb ne prévoit aucun moyen de le récupérer.

- Ajoute ou modifie des identifiants et génère des mots de passe dans le coffre. Les entrées sont enregistrées localement avec Argon2id et XChaCha20-Poly1305.
- **Remplir** apparaît lorsque l’onglet actif correspond exactement à l’origine HTTPS de l’entrée, port inclus. OpenWeb remplit les formulaires de connexion compatibles sans les envoyer. Le bouton **Copier** permet de coller manuellement le mot de passe et efface la copie après 30 secondes si elle est encore dans le presse-papiers.
- Le coffre se verrouille après cinq minutes d’inactivité, à la mise en veille et à la fermeture de la fenêtre normale. Le verrouillage de l’écran déclenche aussi la fermeture du coffre sur les systèmes où Electron remonte cet événement.

## Extensions

1. Ouvre **Extensions** depuis un nouvel onglet. Colle le lien d’une fiche du Chrome Web Store, ou ouvre le Store depuis ce panneau et clique sur **Installer** dans la barre d’outils d’OpenWeb lorsque tu es sur la fiche.
2. OpenWeb télécharge le paquet public auprès du Store et vérifie la signature de l’éditeur du Store, la signature du développeur et l’identifiant de la fiche. Consulte les accès déclarés dans la confirmation avant de l’installer.
3. Tu peux activer, désactiver, supprimer ou vérifier la mise à jour d’une extension du Store. L’installation d’une mise à jour demande une nouvelle confirmation. L’import d’un dossier Chromium contenant `manifest.json` reste disponible.

La compatibilité dépend des API d’extensions qu’Electron prend en charge. Le gestionnaire vise les paquets publics Chromium. Les achats, les extensions réservées à un compte et les fichiers Firefox `.xpi` sont hors de ce mode d’installation. Toute extension reste dans le profil normal. [API d’extensions prises en charge par Electron](https://www.electronjs.org/docs/latest/api/extensions)

## Vérifier

```sh
npm run build
npm test
npm run test:desktop
```

Le test de bureau utilise OpenSSL, un affichage graphique, un serveur HTTPS et un proxy SOCKS5 locaux. Il teste notamment la navigation, le coffre, une extension Manifest V3, la personnalisation de l’accueil et le refus du trafic privé tant que la vérification Tor échoue. Le test utilise une réponse Tor simulée pour éviter de dépendre d’un circuit public.

Le filtrage utilise la bibliothèque Rust adblock de Brave, distribuée sous MPL 2.0. [Code source de la bibliothèque](https://github.com/brave/adblock-rust/tree/v0.13.6)
