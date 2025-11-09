# Points de Contrôle

Les Points de Contrôle versionnent automatiquement vos fichiers d'espace de travail pendant les tâches Kilo Code, permettant l'exploration non-destructive des suggestions IA et la récupération facile des changements non désirés.

Les Points de Contrôle vous permettent de :

- Expérimentent en sécurité avec les changements suggérés par l'IA
- Récupérez facilement des modifications non désirées
- Comparez différentes approches d'implémentation
- Revenez aux états de projet précédents sans perdre de travail

:::info Notes Importantes

- **Les Points de Contrôle sont activés par défaut.**
- **Git doit être installé** pour que les points de contrôle fonctionnent - [voir les instructions d'installation](#installation-de-git)
- Aucun compte GitHub ou dépôt requis
- Aucune configuration d'informations personnelles Git nécessaire
- Le dépôt Git fantôme fonctionne indépendamment de votre configuration Git existante du projet
  :::

## Options de Configuration

Accédez aux paramètres de points de contrôle dans Kilo Code sous la section "Points de Contrôle" :

1. Ouvrez les Paramètres en cliquant sur l'icône d'engrenage <Codicon name="gear" /> → Points de Contrôle
2. Cochez ou décochez la case "Activer les points de contrôle automatiques"

    <img src="/docs/img/checkpoints/checkpoints.png" alt="Paramètres de points de contrôle dans la configuration Kilo Code" width="500" />

## Comment les Points de Contrôle Fonctionnent

Kilo Code capture des instantanés de l'état de votre projet en utilisant un dépôt Git fantôme, séparé de votre système de contrôle de version principal. Ces instantanés, appelés points de contrôle, enregistrement automatiquement les changements tout au long de votre flux de travail assisté par l'IA—quand les tâches commencent, les fichiers changent, ou les commandes s'exécutent.

Les Points de Contrôle sont stockés comme des commits Git dans le dépôt fantôme, capturant :

- Les changements de contenu de fichiers
- Les nouveaux fichiers ajoutés
- Les fichiers supprimés
- Les fichiers renommés
- Les changements de fichiers binaires

## Travailler avec les Points de Contrôle

Les Points de Contrôle sont intégrés directement dans votre flux de travail à travers l'interface de chat.

Les Points de Contrôle apparaissent directement dans votre historique de chat sous deux formes :

- **Point de contrôle initial** marque votre état de projet de départ
  <img src="/docs/img/checkpoints/checkpoints-1.png" alt="Indicateur de point de contrôle initial dans le chat" width="500" />

- **Points de contrôle réguliers** apparaissent après les modifications de fichiers ou l'exécution de commandes
  <img src="/docs/img/checkpoints/checkpoints-2.png" alt="Indicateur de point de contrôle régulier dans le chat" width="500" />

Chaque point de contrôle fournit deux fonctions principales :

### Visualiser les Différences

Pour comparer votre espace de travail actuel avec un point de contrôle précédent :

1. Localisez le point de contrôle dans votre historique de chat
2. Cliquez sur le bouton `Voir les Différences` du point de contrôle

    <img src="/docs/img/checkpoints/checkpoints-6.png" alt="Interface du bouton Voir les Différences" width="100" />

3. Révisez les différences dans la vue de comparaison :
    - Les lignes ajoutées sont mises en évidence en vert
    - Les lignes supprimées sont mises en évidence en rouge
    - Les fichiers modifiés sont listés avec des changements détaillés
    - Les fichiers renommés et déplacés sont suivis avec leurs changements de chemin
    - Les fichiers nouveaux ou supprimés sont clairement marqués

<img src="/docs/img/checkpoints/checkpoints-3.png" alt="Option Voir les différences pour les points de contrôle" width="800" />

### Restaurer les Points de Contrôle

Pour restaurer un projet à un état de point de contrôle précédent :

1. Localisez le point de contrôle dans votre historique de chat
2. Cliquez sur le bouton `Restaurer le Point de Contrôle` du point de contrôle
   <img src="/docs/img/checkpoints/checkpoints-7.png" alt="Interface du bouton Restaurer le point de contrôle" width="100" />
3. Choisissez une de ces options de restauration :

    <img src="/docs/img/checkpoints/checkpoints-4.png" alt="Option Restaurer le point de contrôle" width="300" />

    - **Restaurer les Fichiers Seulement** - Rétablit seulement les fichiers d'espace de travail à l'état de point de contrôle sans modifier l'historique de conversation. Idéal pour comparer les implémentations alternatives tout en maintenant le contexte de chat, vous permettant de basculer parfaitement entre différents états de projet. Cette option ne nécessite pas de confirmation et vous permet de basculer rapidement entre différentes implémentations.
    - **Restaurer les Fichiers et la Tâche** - Rétablit les fichiers d'espace de travail ET supprime tous les messages de conversation subséquents. Utilisez quand vous voulez réinitialiser complètement à la fois votre code et votre conversation au point de contrôle. Cette option nécessite une confirmation dans une boîte de dialogue car elle ne peut pas être annulée.

         <img src="/docs/img/checkpoints/checkpoints-9.png" alt="Boîte de dialogue de confirmation pour restaurer le point de contrôle avec fichiers et tâche" width="300" />

### Limitations et Considérations

- **Portée** : Les Points de Contrôle ne capturent que les changements faits pendant les tâches actives Kilo Code
- **Changements externes** : Les modifications faites en dehors des tâches (éditions manuelles, autres outils) ne sont pas incluses
- **Fichiers volumineux** : Les fichiers binaires très volumineux peuvent impacter les performances
- **Travail non sauvegardé** : La restauration écrasera tous les changements non sauvegardés dans votre espace de travail

## Implémentation Technique

### Architecture des Points de Contrôle

Le système de points de contrôle consiste en :

1. **Dépôt Git Fantôme** : Un dépôt Git séparé créé spécifiquement pour le suivi de points de contrôle qui fonctionne comme le mécanisme de stockage persistant pour l'état de point de contrôle.

2. **Service de Points de Contrôle** : Gère les opérations Git et la gestion d'état à travers :

    - Initialisation du dépôt
    - Création et stockage de points de contrôle
    - Calcul de différences
    - Restauration d'état

3. **Composants UI** : Éléments d'interface affichés dans le chat qui permettent l'interaction avec les points de contrôle.

### Processus de Restauration

Quand la restauration s'exécute, Kilo Code :

- Effectue un reset dur vers le commit de point de contrôle spécifié
- Copie tous les fichiers du dépôt fantôme vers votre espace de travail
- Met à jour l'état de suivi interne des points de contrôle

### Type de Stockage

Les Points de Contrôle sont scopés à la tâche, ce qui signifie qu'ils sont spécifiques à une seule tâche.

### Calcul de Différences

La comparaison de points de contrôle utilise les capacités de différence sous-jacentes de Git pour produire des différences de fichiers structurées :

- Les fichiers modifiés montrent les changements ligne par ligne
- Les fichiers binaires sont correctement détectés et gérés
- Les fichiers renommés et déplacés sont correctement suivis
- La création et suppression de fichiers sont clairement identifiées

### Exclusion de Fichiers et Motifs d'Ignorance

Le système de points de contrôle utilise l'exclusion intelligente de fichiers pour suivre seulement les fichiers pertinents :

#### Exclusions Intégrées

Le système a des motifs d'exclusion intégrés complets qui ignorent automatiquement :

- Les artefacts de build et répertoires de dépendances (`node_modules/`, `dist/`, `build/`)
- Les fichiers média et ressources binaires (images, vidéos, audio)
- Les fichiers de cache et temporaires (`.cache/`, `.tmp/`, `.bak`)
- Les fichiers de configuration avec informations sensibles (`.env`)
- Les gros fichiers de données (archives, exécutables, binaires)
- Les fichiers de base de données et journaux

Ces motifs sont écrits dans le fichier `.git/info/exclude` du dépôt fantôme pendant l'initialisation.

#### Support .gitignore

Le système de points de contrôle respecte les motifs `.gitignore` dans votre espace de travail :

- Les fichiers exclus par `.gitignore` ne déclencheront pas la création de points de contrôle
- Les fichiers exclus n'apparaîtront pas dans les différences de points de contrôle
- Les règles d'ignorance Git standards s'appliquent lors de la mise en scène des changements de fichiers

#### Comportement .kilocodeignore

Le fichier `.kilocodeignore` (qui contrôle l'accès AI aux fichiers) est séparé du suivi de points de contrôle :

- Les fichiers exclus par `.kilocodeignore` mais pas par `.gitignore` seront quand même point de contrôle
- Les changements aux fichiers inaccessibles par l'IA peuvent quand même être restaurés à travers les points de contrôle

Cette séparation est intentionnelle, car `.kilocodeignore` limite quels fichiers l'IA peut accéder, pas quels fichiers devraient être suivis pour l'historique de version.

#### Dépôts Git Imbriqués

Le système de points de contrôle inclut un traitement spécial pour les dépôts Git imbriqués :

- Renomme temporairement les répertoires `.git` imbriqués en `.git_disabled` pendant les opérations
- Les restaure après que les opérations soient complètes
- Permet le suivi approprié des fichiers dans les dépôts imbriqués
- S'assure que les dépôts imbriqués restent fonctionnels et non affectés

### Contrôle de Concurrence

Les opérations sont mises en file d'attente pour prévenir les opérations Git concurrentes qui pourraient corrompre l'état du dépôt. Cela assure que les opérations rapides de points de contrôle se complètent safely même quand demandées en succession rapide.

## Installation de Git

Les Points de Contrôle requièrent que Git soit installé sur votre système. L'implémentation utilise la bibliothèque `simple-git`, qui s'appuie sur les outils de ligne de commande Git pour créer et gérer les dépôts fantômes.

### macOS

1. **Installer avec Homebrew (recommandé)** :

    ```
    brew install git
    ```

2. **Alternative : Installer avec Xcode Command Line Tools** :

    ```
    xcode-select --install
    ```

3. **Vérifier l'installation** :
    - Ouvrez Terminal
    - Tapez `git --version`
    - Vous devriez voir un numéro de version comme `git version 2.40.0`

### Windows

1. **Télécharger Git pour Windows** :

    - Visitez https://git-scm.com/download/win
    - Le téléchargement devrait commencer automatiquement

2. **Exécuter l'installateur** :

    - Acceptez l'accord de licence
    - Choisissez l'emplacement d'installation (défaut recommandé)
    - Sélectionnez les composants (options par défaut généralement suffisantes)
    - Choisissez l'éditeur par défaut
    - Choisissez comment utiliser Git depuis la ligne de commande (recommandé : Git depuis la ligne de commande et aussi depuis les logiciels tiers)
    - Configurez les conversions de fin de ligne (recommandé : Checkout Windows-style, commit Unix-style)
    - Complétez l'installation

3. **Vérifier l'installation** :
    - Ouvrez Command Prompt ou PowerShell
    - Tapez `git --version`
    - Vous devriez voir un numéro de version comme `git version 2.40.0.windows.1`

### Linux

**Debian/Ubuntu** :

```
sudo apt update
sudo apt install git
```

**Fedora** :

```
sudo dnf install git
```

**Arch Linux** :

```
sudo pacman -S git
```

**Vérifier l'installation** :

- Ouvrez Terminal
- Tapez `git --version`
- Vous devriez voir un numéro de version
