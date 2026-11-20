# OpenWeb

OpenWeb est un navigateur de bureau en français. Chromium affiche les sites dans des processus isolés. Un module Rust assure le filtrage réseau et le chiffrement du coffre.

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

## Navigation

- Onglets, favoris, historique, téléchargements, zoom et fenêtre privée avec une session en mémoire.
- Blocage des requêtes publicitaires et de suivi activé au départ. Les listes EasyList et EasyPrivacy sont téléchargées en arrière-plan, puis actualisées au démarrage si elles datent de plus d’une semaine. Les règles de base fonctionnent hors ligne.
- Cases dans **Paramètres** pour le filtrage, les signaux DNT et Global Privacy Control, la préférence HTTPS à la saisie, la restauration des onglets et le thème sombre. Choix entre DuckDuckGo, Qwant et Google.
- Le **mode lecture** extrait le texte de la page dans une vue sans scripts du site.
- Raccourcis `Ctrl/Cmd+L` pour l’adresse, `Ctrl/Cmd+T` pour un onglet, `Ctrl/Cmd+Maj+T` pour rouvrir un onglet fermé et `Ctrl/Cmd+Maj+N` pour la navigation privée.

## Coffre de mots de passe

Ouvre le cadenas dans la barre d’outils et crée un code maître d’au moins 12 caractères. Utilise de préférence une phrase secrète longue et unique. Le code est nécessaire pour déchiffrer le coffre et OpenWeb ne prévoit aucun moyen de le récupérer.

- Ajoute ou modifie des identifiants et génère des mots de passe dans le coffre. Les entrées sont enregistrées localement avec Argon2id et XChaCha20-Poly1305.
- **Remplir** apparaît lorsque l’onglet actif correspond exactement à l’origine HTTPS de l’entrée, port inclus. OpenWeb remplit les formulaires de connexion compatibles sans les envoyer. Le bouton **Copier** permet de coller manuellement le mot de passe et efface la copie après 30 secondes si elle est encore dans le presse-papiers.
- Le coffre se verrouille après cinq minutes d’inactivité, à la mise en veille et à la fermeture de la fenêtre normale. Le verrouillage de l’écran déclenche aussi la fermeture du coffre sur les systèmes où Electron remonte cet événement.

## Extensions

Sélectionne **Extensions** sur un nouvel onglet ou depuis **Paramètres**, puis **Choisir un dossier**. Importe un dossier d’extension Chromium décompressé avec un fichier `manifest.json`. OpenWeb affiche ses accès déclarés avant installation. Le gestionnaire permet d’activer, de désactiver ou de supprimer l’extension. Si une page d’options ou un panneau contextuel est disponible, **Ouvrir** l’ouvre dans un onglet.

Electron prend en charge une partie des API des extensions Chromium. Les extensions décompressées compatibles, notamment certains scripts de contenu, peuvent fonctionner. L’installation directe depuis le Chrome Web Store, les fichiers `.crx` et les extensions Firefox ne sont pas pris en charge. Les extensions importées restent dans le profil normal. [API d’extensions prises en charge par Electron](https://www.electronjs.org/docs/latest/api/extensions)

## Vérifier

```sh
npm run build
npm test
npm run test:desktop
```

Le test de bureau utilise OpenSSL, un affichage graphique et un serveur HTTPS local. Il vérifie le parcours de navigation, le blocage réseau, le coffre, le chargement d’une extension Manifest V3 et l’isolation de la fenêtre privée. Le filtrage actuel agit sur le réseau, et les permissions comme la caméra, le micro et la localisation sont refusées par défaut.

Le filtrage utilise la bibliothèque Rust adblock de Brave, distribuée sous MPL 2.0. [Code source de la bibliothèque](https://github.com/brave/adblock-rust/tree/v0.13.6)
