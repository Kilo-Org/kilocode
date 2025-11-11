# Guide de Développement Kilo Code

Bienvenue dans le guide de développement de Kilo Code ! Ce document vous aider à configurer votre environnement de développement et à comprendre comment travailler avec la base de code. Que vous corrigiez des bugs, ajoutiez des fonctionnalités ou exploriez simplement le code, ce guide vous mettra sur la bonne voie.

## Prérequis

Avant de commencer, choisissez l'une des options d'environnement de développement suivantes :

### Option 1 : Développement Natif (Recommandé pour MacOS/Linux/Windows Subsystem for Linux)

1. **Git** - Pour le contrôle de version
2. **Node.js** (version [v20.19.2](https://github.com/Kilo-Org/kilocode/blob/main/.nvmrc) recommandée)
3. **pnpm** - Gestionnaire de paquets (https://pnpm.io/)
4. **Visual Studio Code** - Notre IDE recommandé pour le développement

### Option 2 : Devcontainer (Recommandé pour Windows)

1. **Git** - Pour le contrôle de version
2. **Docker Desktop** - Pour exécuter le conteneur de développement
3. **Visual Studio Code** - Notre IDE recommandé pour le développement
4. **Extension Dev Containers** - Extension VSCode pour le développement en conteneur

> **Note pour les contributeurs Windows** : Si vous avez des problèmes avec WSL ou souhaitez un environnement de développement standardisé, nous recommandons d'utiliser l'option devcontainer. Elle fournit exactement le même environnement que notre configuration Nix flake mais fonctionne parfaitement sur Windows sans WSL.

### Option 3 : Nix Flake (Recommandé pour les utilisateurs NixOS/Nix)

1. **Git** - Pour le contrôle de version
2. **Nix** - Le gestionnaire de paquets Nix avec les flakes activés
3. **direnv** - Pour le chargement automatique d'environnement
4. **Visual Studio Code** - Notre IDE recommandé pour le développement

## Pour Commencer

### Installation

#### Configuration Développement Natif

1. **Forker et Cloner le Dépôt** :

    - **Forker le Dépôt** :
        - Visitez le [dépôt GitHub Kilo Code](https://github.com/Kilo-Org/kilocode)
        - Cliquez sur le bouton "Fork" dans le coin supérieur droit pour créer votre propre copie.
    - **Cloner Votre Fork** :
        ```bash
        git clone https://github.com/[VOTRE-NOM-USERNAME]/kilocode.git
        cd kilocode
        ```
        Remplacez `[VOTRE-NOM-USERNAME]` par votre nom d'utilisateur GitHub réel.

2. **Installer les dépendances** :

    ```bash
    pnpm install
    ```

    Cette commande installera les dépendances pour l'extension principale, l'interface utilisateur webview et les tests e2e.

3. **Installer les Extensions VSCode** :
    - **Requise** : [ESBuild Problem Matchers](https://marketplace.visualstudio.com/items?itemName=connor4312.esbuild-problem-matchers) - Aide à afficher correctement les erreurs de build.

Bien que strictement nécessaire pour exécuter l'extension, ces extensions sont recommandées pour le développement :

- [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) - Intègre ESLint dans VS Code.
- [Prettier - Formateur de code](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode) - Intègre Prettier dans VS Code.

La liste complète des extensions recommandées se trouve [ici](https://github.com/Kilo-Org/kilocode/blob/main/.vscode/extensions.json)

#### Configuration Devcontainer (Recommandé pour Windows)

1. **Prérequis** :

    - Installez [Docker Desktop](https://www.docker.com/products/docker-desktop/)
    - Installez [Visual Studio Code](https://code.visualstudio.com/)
    - Installez l'extension [Dev Containers](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers)

2. **Forker et Cloner le Dépôt** (identique à ci-dessus)

3. **Ouvrir dans Devcontainer** :

    - Ouvrez le projet dans VSCode
    - Lorsque vous y êtes invité, cliquez sur "Reopen in Container" ou utilisez la Palette de Commandes : `Dev Containers: Reopen in Container`
    - Attendez que le conteneur se construise et que la configuration se termine (cela peut prendre quelques minutes lors de la première exécution)

4. **Commencer le Développement** :
    - Toutes les dépendances sont automatiquement installées
    - Toutes les extensions VSCode recommandées sont pré-installées
    - Appuyez sur F5 pour commencer le débogage de l'extension

#### Configuration Nix Flake (Recommandé pour les utilisateurs NixOS/Nix)

1. **Prérequis** :

    - Installez [Nix](https://nixos.org/download.html) avec les flakes activés
    - Installez [direnv](https://direnv.net/) pour le chargement automatique d'environnement
    - Installez [Visual Studio Code](https://code.visualstudio.com/)
    - (Optionnel) Installez l'extension VSCode [mkhl.direnv](https://marketplace.visualstudio.com/items?itemName=mkhl.direnv) pour une meilleure intégration direnv

2. **Forker et Cloner le Dépôt** (identique à ci-dessus)

3. **Configurer l'Environnement de Développement** :

    ```bash
    cd kilocode
    direnv allow
    ```

    Le projet inclut un fichier [`.envrc`](.envrc) qui charge automatiquement l'environnement Nix flake lorsque vous entrez dans le répertoire. Cela fournit :

    - Node.js 20 (correspondant à la version dans `.nvmrc`)
    - pnpm (via corepack)
    - Toutes les autres dépendances de développement nécessaires

4. **Installer les Dépendances du Projet** :

    ```bash
    pnpm install
    ```

5. **Installer les Extensions VSCode** (identique à la configuration de développement natif ci-dessus)

6. **Commencer le Développement** :
    - Appuyez sur F5 pour commencer le débogage de l'extension
    - L'environnement est automatiquement activé lorsque vous entrez dans le répertoire du projet
    - Pas besoin d'exécuter manuellement `nix develop` - direnv s'en charge automatiquement

### Structure du Projet

Le projet est organisé en plusieurs répertoires clés :

- **`src/`** - Code de l'extension principale
    - **`core/`** - Fonctionnalité principale et outils
    - **`services/`** - Implémentations de services
- **`webview-ui/`** - Code de l'interface utilisateur frontend
- **`e2e/`** - Tests de bout en bout
- **`scripts/`** - Scripts utilitaires
- **`assets/`** - Ressources statiques comme les images et icônes

## Flux de Travail de Développement

### Exécuter l'Extension

Pour exécuter l'extension en mode développement :

1. Appuyez sur `F5` (ou sélectionnez **Exécuter** → **Démarrer le Débogage**) dans VSCode
2. Cela ouvrira une nouvelle fenêtre VSCode avec Kilo Code chargé

### Rechargement à Chaud

- **Changements interface utilisateur webview** : Les modifications à l'interface utilisateur webview apparaîtront immédiatement sans redémarrage
- **Changements extension principale** : Les modifications au code de l'extension principale rechargeront automatiquement l'ext host

En mode développement (NODE_ENV="development"), modifier le code principal déclenchera une commande `workbench.action.reloadWindow`, donc il n'est plus nécessaire de démarrer/arrêter manuellement le débogueur et les tâches.

> **Important** : Dans les builds de production, lorsque vous modifiez l'extension principale, vous devez :

> 1. Arrêter le processus de débogage
> 2. Tuer toutes les tâches npm s'exécutant en arrière-plan (voir capture d'écran ci-dessous)
> 3. Redémarrer le débogage

<img width="600" alt="Arrêter les tâches en arrière-plan" src="https://github.com/user-attachments/assets/466fb76e-664d-4066-a3f2-0df4d57dd9a4" />

### Construire l'Extension

Pour construire un fichier `.vsix` prêt pour la production :

```bash
pnpm build
```

Cela va :

1. Construire l'interface utilisateur webview
2. Compiler TypeScript
3. Regrouper l'extension
4. Créer un fichier `.vsix` dans le répertoire `bin/`

### Installer l'Extension Construite

Pour installer votre extension construite :

```bash
code --install-extension "$(ls -1v bin/kilo-code-*.vsix | tail -n1)"
```

Remplacez `[version]` par le numéro de version actuel.

## Tests

Kilo Code utilise plusieurs types de tests pour assurer la qualité :

### Tests Unitaires

Exécutez les tests unitaires avec :

```bash
pnpm test
```

Cela exécute à la fois les tests d'extension et de webview.

### Tests de Bout en Bout

Pour plus de détails sur les tests E2E, voir [apps/vscode-e2e](apps/vscode-e2e/).

## Linting et Vérification de Types

Assurez-vous que votre code respecte nos standards de qualité :

```bash
pnpm lint          # Exécuter ESLint
pnpm check-types   # Exécuter la vérification de types TypeScript
```

## Git Hooks

Ce projet utilise [Husky](https://typicode.github.io/husky/) pour gérer les Git hooks, qui automatisent certaines vérifications avant les commits et pushes. Les hooks sont located dans le répertoire `.husky/`.

### Hook Pre-commit

Avant qu'un commit soit finalisé, le hook `.husky/pre-commit` s'exécute :

1.  **Vérification de Branche** : Empêche de committer directement sur la branche `main`.
2.  **Génération de Types** : Exécute `pnpm --filter kilo-code generate-types`.
3.  **Vérification de Fichier de Types** : S'assure que toutes les modifications apportées à `src/exports/roo-code.d.ts` par la génération de types sont stagées.
4.  **Linting** : Exécute `lint-staged` pour analyser et formater les fichiers stagés.

### Hook Pre-push

Avant que les modifications soient poussées vers le dépôt distant, le hook `.husky/pre-push` s'exécute :

1.  **Vérification de Branche** : Empêche de pousser directement vers la branche `main`.
2.  **Compilation** : Exécute `pnpm run check-types` pour s'assurer que le typage est correct.
3.  **Vérification Changeset** : Vérifie si un fichier changeset existe dans `.changeset/` et vous rappelle d'en créer un en utilisant `npm run changeset` si nécessaire.

Ces hooks aident à maintenir la qualité et la consistance du code. Si vous rencontrez des problèmes avec les commits ou pushes, vérifiez la sortie de ces hooks pour les messages d'erreur.

## Dépannage

### Problèmes Courants

1. **Extension ne se charge pas** : Vérifiez les Outils Développeur VSCode (Help > Toggle Developer Tools) pour les erreurs
2. **Webview ne se met pas à jour** : Essayez de recharger la fenêtre (Developer: Reload Window)
3. **Erreurs de build** : Assurez-vous que toutes les dépendances sont installées avec `pnpm install`

### Conseils de Débogage

- Utilisez des instructions `console.log()` dans votre code pour le débogage
- Vérifiez le panneau Sortie dans VSCode (View > Output) et sélectionnez "Kilo Code" dans le menu déroulant
- Pour les problèmes de webview, utilisez les outils de développement du navigateur dans la webview (clic droit > "Inspecter l'Élément")

### Test avec un Backend Local

Pour tester l'extension contre un backend Kilo Code local :

1. **Configurez votre backend local** à `http://localhost:3000`
2. **Utilisez la configuration de lancement "Run Extension [Local Backend]"** :
    - Allez dans Run and Debug (Ctrl+Shift+D)
    - Sélectionnez "Run Extension [Local Backend]" dans le menu déroulant
    - Appuyez sur F5 pour commencer le débogage

Cela définit automatiquement la variable d'environnement `KILOCODE_BACKEND_BASE_URL`,使得 tous les boutons de connexion/inscription pointent vers votre backend local au lieu de la production.

## Contribution

Nous accueillons les contributions à Kilo Code ! Voici comment vous pouvez aider :

1. **Signaler un problème** en utilisant [GitHub Issues](https://github.com/Kilo-Org/kilocode/issues)
2. **Trouver un problème** et soumettre une Pull Request avec votre correction
3. **Écrire des tests** pour améliorer la Couverture de Code
4. **Améliorer la Documentation** à [kilocode.ai/docs](https://kilocode.ai/docs)
5. **Suggérer une nouvelle fonctionnalité** en utilisant [GitHub Discussions](https://github.com/Kilo-Org/kilocode/discussions/categories/ideas)!
6. Voulez-vous **implémenter quelque chose de nouveau** ? Merveilleux ! Nous serions ravis de vous soutenir sur [Discord](https://discord.gg/Ja6BkfyTzJ)!

## Communauté

Vos contributions sont les bienvenues ! Pour des questions ou des idées, veuillez rejoindre notre serveur Discord : https://discord.gg/Ja6BkfyTzJ

Nous avons hâte de voir vos contributions et votre retour !
