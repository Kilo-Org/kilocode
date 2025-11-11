# Environnement de Développement

<!-- Veuillez vous référer au guide [DEVELOPMENT.md](https://github.com/Kilo-Org/kilocode/blob/main/DEVELOPMENT.md) dans le dépôt principal pour des instructions détaillées sur la configuration de l'environnement de développement. -->

Ce document vous aidera à configurer votre environnement de développement et à comprendre comment travailler avec la base de code. Que vous corrigiez des bogues, ajoutiez des fonctionnalités ou exploriez simplement le code, ce guide vous aidera à démarrer.

## Prérequis

Avant de commencer, assurez-vous d'avoir installé les éléments suivants :

1. **Git** - Pour le contrôle de version
2. **Node.js** (version [v20.18.1](https://github.com/Kilo-Org/kilocode/blob/main/.nvmrc) ou supérieure recommandée) et npm
3. **Visual Studio Code** - Notre IDE recommandé pour le développement

## Premiers Pas

### Installation

1. **Forker et Cloner le Dépôt** :

    - **Forker le Dépôt** :
        - Visitez le [dépôt GitHub Kilo Code](https://github.com/Kilo-Org/kilocode)
        - Cliquez sur le bouton "Fork" dans le coin supérieur droit pour créer votre propre copie.
    - **Cloner votre Fork** :
        ```bash
        git clone https://github.com/[YOUR-USERNAME]/kilocode.git
        cd kilocode
        ```
        Remplacez `[YOUR-USERNAME]` par votre nom d'utilisateur GitHub réel.

1. **Installer les dépendances** :

    ```bash
    pnpm install
    ```

    Cette commande installera les dépendances pour l'extension principale, l'interface webview et les tests e2e.

1. **Installer les Extensions VSCode** :
    - **Obligatoire** : [ESBuild Problem Matchers](https://marketplace.visualstudio.com/items?itemName=connor4312.esbuild-problem-matchers) - Aide à afficher correctement les erreurs de build.

Bien que ne soient pas strictement nécessaires pour exécuter l'extension, ces extensions sont recommandées pour le développement :

- [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) - Intègre ESLint dans VS Code.
- [Prettier - Code formatter](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode) - Intègre Prettier dans VS Code.

La liste complète des extensions recommandées se trouve [ici](https://github.com/Kilo-Org/kilocode/blob/main/.vscode/extensions.json)

### Structure du Projet

Le projet est organisé en plusieurs répertoires clés :

- **`src/`** - Code de l'extension principale
    - **`core/`** - Fonctionnalité principale et outils
    - **`services/`** - Implémentations des services
    - **`webview-ui/`** - Code de l'interface frontend
    - **`e2e/`** - Tests de bout en bout
    - **`scripts/`** - Scripts utilitaires
    - **`assets/`** - Ressources statiques comme les images et icônes

## Flux de Travail de Développement

### Compiler l'Extension

Pour compiler l'extension :

```bash
pnpm build
```

Ceci va :

1. Compiler l'interface webview
2. Compiler TypeScript
3. Bundler l'extension
4. Créer un fichier `.vsix` dans le répertoire `bin/`

### Exécuter l'Extension

Pour exécuter l'extension en mode développement :

1. Appuyez sur `F5` (ou sélectionnez **Run** → **Start Debugging**) dans VSCode
2. Ceci ouvrira une nouvelle fenêtre VSCode avec Kilo Code chargé

### Rechargement à Chaud (Hot Reloading)

- **Changements de l'interface webview** : Les changements de l'interface webview apparaîtront immédiatement sans redémarrage
- **Changements de l'extension principale** : Les changements du code de l'extension principale rechargeront automatiquement l'hôte d'extension

En mode développement (NODE_ENV="development"), changer le code principal déclenchera une commande `workbench.action.reloadWindow`, il n'est donc plus nécessaire de démarrer/arrêter manuellement le débogueur et les tâches.

> **Important** : Dans les builds de production, lorsque vous apportez des modifications à l'extension principale, vous devez :
>
> 1. Arrêter le processus de débogage
> 2. Tuer toutes les tâches npm s'exécutant en arrière-plan (voir capture d'écran ci-dessous)
> 3. Redémarrer le débogage

<img width="600" alt="Stopping background tasks" src="https://github.com/user-attachments/assets/466fb76e-664d-4066-a3f2-0df4d57dd9a4" />

### Installer l'Extension Compilée

Pour installer votre extension compilée :

```bash
code --install-extension "$(ls -1v bin/kilo-code-*.vsix | tail -n1)"
```

Remplacez `[version]` par le numéro de version actuel.

## Tests

Kilo Code utilise plusieurs types de tests pour assurer la qualité :

### Tests Unitaires

Exécutez les tests unitaires avec :

```bash
npm test
```

Ceci exécute à la fois les tests d'extension et les tests webview.

Pour exécuter des suites de tests spécifiques :

```bash
npm run test:extension  # Exécuter uniquement les tests d'extension
npm run test:webview    # Exécuter uniquement les tests webview
```

### Tests de Bout en Bout

Les tests E2E vérifient que l'extension fonctionne correctement dans VSCode :

1. Créez un fichier `.env.local` à la racine avec les clés API requises :

    ```
    OPENROUTER_API_KEY=sk-or-v1-...
    ```

2. Exécutez les tests d'intégration :
    ```bash
    npm run test:integration
    ```

Pour plus de détails sur les tests E2E, consultez [e2e/VSCODE_INTEGRATION_TESTS.md](https://github.com/Kilo-Org/kilocode/blob/main/e2e/VSCODE_INTEGRATION_TESTS.md).

## Linting et Vérification de Types

Assurez-vous que votre code respecte nos standards de qualité :

```bash
npm run lint          # Exécuter ESLint
npm run check-types   # Exécuter la vérification de types TypeScript
```

## Git Hooks

Ce projet utilise [Husky](https://typicode.github.io/husky/) pour gérer les Git hooks, qui automatisent certaines vérifications avant les commits et les pushes. Les hooks sont situés dans le répertoire `.husky/`.

### Pre-commit Hook

Avant qu'un commit ne soit finalisé, le hook `.husky/pre-commit` s'exécute :

1.  **Vérification de Branche** : Empêche de commiter directement sur la branche `main`.
2.  **Génération de Types** : Exécute `npm run generate-types`.
3.  **Vérification de Fichier de Types** : S'assure que tous les changements faits à `src/exports/roo-code.d.ts` par la génération de types sont staged.
4.  **Linting** : Exécute `lint-staged` pour lint et formater les fichiers staged.

### Pre-push Hook

Avant que les changements ne soient poussés vers le dépôt distant, le hook `.husky/pre-push` s'exécute :

1.  **Vérification de Branche** : Empêche de pousser directement sur la branche `main`.
2.  **Compilation** : Exécute `npm run compile` pour s'assurer que le projet se compile correctement.
3.  **Vérification de Changeset** : Vérifie si un fichier changeset existe dans `.changeset/` et vous rappelle d'en créer un en utilisant `npm run changeset` si nécessaire.

Ces hooks aident à maintenir la qualité et la cohérence du code. Si vous rencontrez des problèmes avec les commits ou les pushes, vérifiez la sortie de ces hooks pour les messages d'erreur.

## Dépannage

### Problèmes Courants

1. **Extension ne se charge pas** : Vérifiez les Outils de Développement VSCode (Help > Toggle Developer Tools) pour les erreurs
2. **Webview ne se met pas à jour** : Essayez de recharger la fenêtre (Developer: Reload Window)
3. **Erreurs de build** : Assurez-vous que toutes les dépendances sont installées avec `npm run install:all`

### Conseils de Débogage

- Utilisez les instructions `console.log()` dans votre code pour le débogage
- Vérifiez le panneau Output dans VSCode (View > Output) et sélectionnez "Kilo Code" dans le menu déroulant
- Pour les problèmes de webview, utilisez les outils de développement du navigateur dans la webview (clic droit > "Inspect Element")
