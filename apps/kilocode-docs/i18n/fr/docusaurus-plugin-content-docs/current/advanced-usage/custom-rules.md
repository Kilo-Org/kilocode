# Règles personnalisées

<YouTubeEmbed
  url="https://youtu.be/GF0vjB8NxYg"
/>

Les règles personnalisées fournissent un moyen puissant de définir des comportements et contraintes spécifiques au projet et globaux pour l'agent IA Kilo Code. Avec les règles personnalisées, vous pouvez assurer un formatage cohérent, restreindre l'accès aux fichiers sensibles, faire respecter les normes de codage, et personnaliser le comportement de l'IA pour vos besoins spécifiques de projet ou pour tous les projets.

## Vue d'ensemble

Les règles personnalisées vous permettent de créer des instructions basées sur du texte que tous les modèles IA suivront lorsqu'ils interagiront avec votre projet. Ces règles agissent comme des garde-fous et conventions qui sont respectées de manière cohérente dans toutes les interactions avec votre base de code. Les règles peuvent être gérées à la fois via le système de fichiers et l'interface utilisateur intégrée.

## Format des règles

Les règles personnalisées peuvent être écrites en texte brut, mais le format Markdown est recommandé pour une meilleure structure et compréhension par les modèles IA. La nature structurée de Markdown aide les modèles à analyser et comprendre vos règles plus efficacement.

- Utilisez les en-têtes Markdown (`#`, `##`, etc.) pour définir les catégories de règles
- Utilisez les listes (`-`, `*`) pour énumérer des éléments ou contraintes spécifiques
- Utilisez les blocs de code (` `) pour inclure des exemples de code lorsque nécessaire

## Types de règles

Kilo Code prend en charge deux types de règles personnalisées :

- **Règles de projet** : S'appliquent uniquement à l'espace de travail du projet actuel
- **Règles globales** : S'appliquent à tous les projets et espaces de travail

:::note Prise en charge de l'interface utilisateur
L'interface utilisateur de gestion des règles intégrée est disponible uniquement pour les règles générales. Les règles spécifiques aux modes doivent être gérées via le système de fichiers.
:::

## Emplacement des règles

### Règles de projet

Les règles personnalisées sont principalement chargées à partir du **répertoire `.kilocode/rules/`**. C'est l'approche recommandée pour organiser vos règles spécifiques au projet. Chaque règle est typiquement placée dans son propre fichier Markdown avec un nom descriptif :

```
project/
├── .kilocode/
│   ├── rules/
│   │   ├── formatting.md
│   │   ├── restricted_files.md
│   │   └── naming_conventions.md
├── src/
└── ...
```

### Règles globales

Les règles globales sont stockées dans votre répertoire personnel et s'appliquent à tous les projets :

```
~/.kilocode/
├── rules/
│   ├── coding_standards.md
│   ├── security_guidelines.md
│   └── documentation_style.md
```

## Gestion des règles via l'interface utilisateur

Kilo Code fournit une interface intégrée pour gérer vos règles personnalisées sans éditer manuellement les fichiers dans les répertoires `.kilocode/rules/`. Pour accéder à l'interface utilisateur, cliquez sur l'icône <Codicon name="law" /> dans le **coin inférieur droit** de la fenêtre Kilo Code.

Vous pouvez accéder à l'interface utilisateur de gestion des règles pour :

- Voir toutes les règles actives (projet et globales)
- Activer/désactiver les règles sans les supprimer
- Créer et éditer des règles directement dans l'interface
- Organiser les règles par catégorie et priorité

## Ordre de chargement des règles

### Règles générales (tous modes)

Les règles sont chargées dans l'ordre de priorité suivant :

1. **Règles globales** du répertoire `~/.kilocode/rules/`
2. **Règles de projet** du répertoire `.kilocode/rules/`
3. **Fichiers de repli hérités** (pour compatibilité ascendante) :
    - `.roorules`
    - `.clinerules`
    - `.kilocoderules` (déprécié)

Lorsque des règles globales et de projet existent, elles sont combinées avec les règles de projet prenant le pas sur les règles globales pour les directives conflictuelles.

:::note
Nous recommandons fortement de conserver vos règles dans le dossier `.kilocode/rules/` car il fournit une meilleure organisation et est l'approche privilégiée pour les versions futures. La structure basée sur les dossiers permet une organisation plus granulaire des règles et une séparation plus claire des préoccupations. L'approche basée sur les fichiers héritée est maintenue pour la compatibilité ascendante mais pourrait être sujette à changement dans les versions futures.
:::

### Règles spécifiques aux modes

De plus, le système prend en charge les règles spécifiques aux modes, qui sont chargées séparément et ont leur propre ordre de priorité :

1. D'abord, il vérifie le répertoire `.kilocode/rules-${mode}/`
2. Si celui-ci n'existe pas ou est vide, il revient au fichier `.kilocoderules-${mode}` (déprécié)

Actuellement, les règles spécifiques aux modes sont uniquement prises en charge au niveau du projet.
Lorsque des règles génériques et des règles spécifiques aux modes existent, les règles spécifiques aux modes ont la priorité dans la sortie finale.

## Création de règles personnalisées

### Utilisation de l'interface utilisateur

<img src="/docs/img/custom-rules/rules-ui.png" alt="Onglet Règles dans Kilo Code" width="400" />

Le moyen le plus simple de créer et gérer les règles est via l'interface utilisateur intégrée :

1. Accédez à l'interface de gestion des règles depuis le panneau Kilo Code
2. Choisissez entre créer des règles spécifiques au projet ou globales
3. Utilisez l'interface pour créer, éditer ou activer/désactiver les règles
4. Les règles sont automatiquement sauvegardées et appliquées immédiatement

### Utilisation du système de fichiers

Pour créer des règles manuellement :

**Pour les règles de projet :**

1. Créez le répertoire `.kilocode/rules/` s'il n'existe pas déjà
2. Créez un nouveau fichier Markdown avec un nom descriptif dans ce répertoire
3. Écrivez votre règle en utilisant le formatage Markdown
4. Sauvegardez le fichier

**Pour les règles globales :**

1. Créez le répertoire `~/.kilocode/rules/` s'il n'existe pas déjà
2. Créez un nouveau fichier Markdown avec un nom descriptif dans ce répertoire
3. Écrivez votre règle en utilisant le formatage Markdown
4. Sauvegardez le fichier

Les règles seront automatiquement appliquées à toutes les futures interactions avec Kilo Code. Tous les nouveaux changements seront appliqués immédiatement.

## Exemples de règles

### Exemple 1 : Formatage de tableaux

```markdown
# Tableaux

Lors de l'impression de tableaux, ajoutez toujours un point d'exclamation à chaque en-tête de colonne
```

Cette règle simple instruit l'IA à ajouter des points d'exclamation à tous les en-têtes de colonne de tableaux lors de la génération de tableaux dans votre projet.

### Exemple 2 : Accès restreint aux fichiers

```markdown
# Fichiers restreints

Les fichiers dans la liste contiennent des données sensibles, ils NE DOIVENT PAS être lus

- supersecrets.txt
- credentials.json
- .env
```

Cette règle empêche l'IA de lire ou d'accéder à des fichiers sensibles, même si on lui demande explicitement de le faire.

<img src="/docs/img/custom-rules/custom-rules.png" alt="Kilo Code ignore la demande de lire un fichier sensible" width="600" />

## Cas d'usage

Les règles personnalisées peuvent être appliquées à une grande variété de scénarios :

- **Style de code** : Faire respecter un formatage cohérent, des conventions de nommage et des styles de documentation
- **Contrôles de sécurité** : Empêcher l'accès aux fichiers ou répertoires sensibles
- **Structure de projet** : Définir où différents types de fichiers doivent être créés
- **Exigences de documentation** : Spécifier les formats et exigences de documentation
- **Modèles de test** : Définir comment les tests doivent être structurés
- **Utilisation d'API** : Spécifier comment les API doivent être utilisées et documentées
- **Gestion des erreurs** : Définir les conventions de gestion des erreurs

## Exemples de règles personnalisées

- "Suivre strictement le guide de style de code [votre guide de style de code spécifique au projet]"
- "Toujours utiliser des espaces pour l'indentation, avec une largeur de 4 espaces"
- "Utiliser camelCase pour les noms de variables"
- "Écrire des tests unitaires pour toutes les nouvelles fonctions"
- "Expliquer votre raisonnement avant de fournir du code"
- "Se concentrer sur la lisibilité et la maintenabilité du code"
- "Prioriser l'utilisation de la bibliothèque la plus commune dans la communauté"
- "Lors de l'ajout de nouvelles fonctionnalités aux sites web, assurer qu'elles sont responsives et accessibles"

## Meilleures pratiques

- **Soyez spécifique** : Définissez clairement la portée et l'intention de chaque règle
- **Utilisez des catégories** : Organisez les règles connexes sous des en-têtes communs
- **Séparez les préoccupations** : Utilisez différents fichiers pour différents types de règles
- **Utilisez des exemples** : Incluez des exemples pour illustrer le comportement attendu
- **Gardez-le simple** : Les règles doivent être concises et faciles à comprendre
- **Mettez à jour régulièrement** : Révisez et mettez à jour les règles à mesure que les exigences du projet changent

:::tip Astuce de pro : Normes d'équipe basées sur des fichiers
Lorsque vous travaillez dans des environnements d'équipe, placer des fichiers `.kilocode/rules/codestyle.md` sous contrôle de version vous permet de standardiser le comportement de Kilo sur toute votre équipe de développement. Cela assure un style de code cohérent, des pratiques de documentation et des workflows de développement pour tous les participants au projet.
:::

## Limitations

- Les règles sont appliquées sur la base du meilleur effort par les modèles IA
- Les règles complexes peuvent nécessiter plusieurs exemples pour une compréhension claire
- Les règles de projet s'appliquent uniquement au projet dans lequel elles sont définies
- Les règles globales s'appliquent à tous les projets

## Dépannage

Si vos règles personnalisées ne sont pas correctement suivies :

1. **Vérifiez le statut des règles dans l'interface utilisateur** : Utilisez l'interface de gestion des règles pour vérifier que vos règles sont actives et correctement chargées
1. **Vérifiez le formatage des règles** : Assurez-vous que vos règles sont correctement formatées avec une structure Markdown claire
1. **Vérifiez les emplacements des règles** : Assurez-vous que vos règles sont situées dans des emplacements pris en charge :
    - Règles globales : répertoire `~/.kilocode/rules/`
    - Règles de projet : répertoire `.kilocode/rules/`
    - Fichiers hérités : `.kilocoderules`, `.roorules`, ou `.clinerules`
1. **Spécificité des règles** : Vérifiez que les règles sont spécifiques et non ambiguës
1. **Redémarrez VS Code** : Redémarrez VS Code pour assurer que les règles sont correctement chargées

## Fonctionnalités connexes

- [Modes personnalisés](/docs/features/custom-modes)
- [Instructions personnalisées](/advanced-usage/custom-instructions)
- [Gestion des paramètres](/docs/features/settings-management)
- [Paramètres d'approbation automatique](/docs/features/auto-approving-actions)
