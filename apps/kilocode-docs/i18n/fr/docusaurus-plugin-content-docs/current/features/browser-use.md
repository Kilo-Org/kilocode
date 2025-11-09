# Utilisation du Navigateur

Kilo Code fournit des capacités sophistiquées d'automatisation de navigateur qui vous permettent d'interagir avec les sites web directement depuis VS Code. Cette fonctionnalité permet de tester les applications web, automatiser les tâches de navigateur et capturer des captures d'écran sans quitter votre environnement de développement.

:::info Support de Modèle Requis
L'Utilisation du Navigateur dans Kilo Code nécessite l'utilisation du modèle agentique avancé, et n'a été testé qu'avec Claude Sonnet 3.5, 3.7, et 4
:::

## Comment Utilisation du Navigateur Fonctionne

Par défaut, Kilo Code utilise un navigateur intégré qui :

- Se lance automatiquement quand vous demandez à Kilo de visiter un site web
- Capture des captures d'écran des pages web
- Permet à Kilo d'interagir avec les éléments web
- Fonctionne invisiblement en arrière-plan

Tout cela se produit directement dans VS Code, sans configuration nécessaire.

## Utiliser Utilisation du Navigateur

Une interaction typique de navigateur suit ce modèle :

1. Demandez à Kilo de visiter un site web
2. Kilo lance le navigateur et vous montre une capture d'écran
3. Demandez des actions supplémentaires (cliquer, taper, faire défiler)
4. Kilo ferme le navigateur quand terminé

Par exemple :

```
Ouvrir le navigateur et voir notre site.
```

```
Pouvez-vous vérifier si mon site web à https://kilocode.ai s'affiche correctement ?
```

```
Parcourir http://localhost:3000, faire défiler jusqu'au bas de la page et vérifier si les informations du pied de page s'affichent correctement.
```

<img src="/docs/features/KiloCodeBrowser.png" alt="Exemple d'utilisation du navigateur" width="300" />

## Comment les Actions de Navigateur Fonctionnent

L'outil browser_action contrôle une instance de navigateur qui retourne des captures d'écran et des journaux de console après chaque action, vous permettant de voir les résultats des interactions.

Caractéristiques clés :

- Chaque session de navigateur doit commencer avec `launch` et finir avec `close`
- Une seule action de navigateur peut être utilisée par message
- Pendant que le navigateur est actif, aucun autre outil ne peut être utilisé
- Vous devez attendre la réponse (capture d'écran et journaux) avant de performer la prochaine action

### Actions de Navigateur Disponibles

| Action        | Description                          | Quand l'Utiliser                            |
| ------------- | ------------------------------------ | ------------------------------------------- |
| `launch`      | Ouvre un navigateur à une URL        | Démarrer une nouvelle session de navigateur |
| `click`       | Clique à des coordonnées spécifiques | Interagir avec les boutons, liens, etc.     |
| `type`        | Tape du texte dans l'élément actif   | Remplir les formulaires, cases de recherche |
| `scroll_down` | Fait défiler vers le bas d'une page  | Voir le contenu en dessous du pli           |
| `scroll_up`   | Fait défiler vers le haut d'une page | Revenir au contenu précédent                |
| `close`       | Ferme le navigateur                  | Terminer une session de navigateur          |

## Configuration/Paramètres d'Utilisation du Navigateur

:::info Paramètres de Navigateur par Défaut

- **Activer l'outil navigateur** : Activé
- **Taille de fenêtre d'affichage** : Petit Bureau (900x600)
- **Qualité de capture d'écran** : 75%
- **Utiliser la connexion de navigateur distante** : Désactivé
  :::

### Accéder aux Paramètres

Pour changer les paramètres d'Utilisation du Navigateur/Ordinateur dans Kilo :

1. Ouvrez les Paramètres en cliquant sur l'icône d'engrenage <Codicon name="gear" /> → Navigateur / Utilisation d'Ordinateur

    <img src="/docs/img/browser-use/browser-use.png" alt="Menu des paramètres de navigateur" width="600" />

### Activer/Désactiver Utilisation du Navigateur

**Objectif** : Interrupteur principal qui permet à Kilo d'interagir avec les sites web en utilisant un navigateur contrôlé par Puppeteer.

Pour changer ce paramètre :

1. Cochez ou décochez la case "Activer l'outil navigateur" dans vos paramètres Navigateur / Utilisation d'Ordinateur

    <img src="/docs/img/browser-use/browser-use-2.png" alt="Paramètre Activer l'outil navigateur" width="300" />

### Taille de Fenêtre d'Affichage

**Objectif** : Détermine la résolution de la session de navigateur que Kilo Code utilise.

**Compromis** : Les valeurs plus élevées fournissent une fenêtre d'affichage plus grande mais augmentent l'utilisation de tokens.

Pour changer ce paramètre :

1. Cliquez sur le menu déroulant sous "Taille de fenêtre d'affichage" dans vos paramètres Navigateur / Utilisation d'Ordinateur
2. Sélectionnez une des options disponibles :
    - Grand Bureau (1280x800)
    - Petit Bureau (900x600) - Par Défaut
    - Tablette (768x1024)
    - Mobile (360x640)
3. Sélectionnez la résolution souhaitée.

    <img src="/docs/img/browser-use/browser-use-3.png" alt="Paramètre de taille de fenêtre d'affichage" width="600" />

### Qualité de Capture d'Écran

**Objectif** : Contrôle la qualité de compression WebP des captures d'écran du navigateur.

**Compromis** : Les valeurs plus élevées fournissent des captures d'écran plus claires mais augmentent l'utilisation de tokens.

Pour changer ce paramètre :

1. Ajustez le curseur sous "Qualité de capture d'écran" dans vos paramètres Navigateur / Utilisation d'Ordinateur
2. Définissez une valeur entre 1-100% (par défaut est 75%)
3. Les valeurs plus élevées fournissent des captures d'écran plus claires mais augmentent l'utilisation de tokens :

    - 40-50% : Bon pour les sites web basés sur du texte de base
    - 60-70% : Équilibré pour la plupart de la navigation générale
    - 80%+ : Utilisez quand les détails visuels fins sont critiques

    <img src="/docs/img/browser-use/browser-use-4.png" alt="Paramètre de qualité de capture d'écran" width="600" />

### Connexion de Navigateur Distante

**Objectif** : Connecter Kilo à un navigateur Chrome existant au lieu d'utiliser le navigateur intégré.

**Avantages** :

- Fonctionne dans les environnements conteneurisés et les flux de développement distants
- Maintient les sessions authentifiées entre les utilisations du navigateur
- Élimine les étapes de connexion répétitives
- Permet l'utilisation de profils de navigateur personnalisés avec des extensions spécifiques

**Prérequis** : Chrome doit être en cours d'exécution avec le débogage distant activé.

Pour activer cette fonctionnalité :

1. Cochez la case "Utiliser la connexion de navigateur distante" dans les paramètres Navigateur / Utilisation d'Ordinateur
2. Cliquez sur "Tester la Connexion" pour vérifier

    <img src="/docs/img/browser-use/browser-use-5.png" alt="Paramètre de connexion de navigateur distante" width="600" />

#### Cas d'Utilisation Communs

- **DevContainers** : Se connecter depuis VS Code conteneurisé vers le navigateur Chrome hôte
- **Développement Distant** : Utiliser Chrome local avec le serveur VS Code distant
- **Profils Chrome Personnalisés** : Utiliser des profils avec des extensions et paramètres spécifiques

#### Se Connecter à une Fenêtre Chrome Visible

Connectez-vous à une fenêtre Chrome visible pour observer les interactions de Kilo en temps réel :

**macOS**

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-debug --no-first-run
```

**Windows**

```bash
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir=C:\chrome-debug --no-first-run
```

**Linux**

```bash
google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-debug --no-first-run
```
