# Générer des Messages de Commit

Générez automatiquement des messages de commit descriptifs basés sur vos changements git staged. Kilo Code analyse vos fichiers staged et crée des messages de commit conventionnels qui suivent les meilleures pratiques.

:::info
Cette fonctionnalité analyse uniquement les **changements staged**. Assurez-vous de stager vos fichiers en utilisant `git add` ou via l'interface `VS Code` avant de générer des messages de commit.
:::

## Fonctionnement

Le générateur de messages de commit git :

- Analyse uniquement vos **changements staged** (pas les fichiers non staged ou non suivis)
- Utilise l'IA pour comprendre le contexte et le but de vos changements
- Crée des messages de commit descriptifs qui expliquent ce qui a été changé et pourquoi en suivant les [Conventional Commits](https://www.conventionalcommits.org/) (par défaut, personnalisable)

## Utilisation de la Fonctionnalité

### Générer un Message de Commit

1. Stagez vos changements en utilisant `git add` ou l'interface git VS Code
2. Dans le panneau Source Control de VS Code, cherchez le logo `Kilo Code` à côté du champ de message de commit
3. Cliquez sur le logo pour générer un message de commit

Le message généré apparaîtra dans le champ de message de commit, prêt pour que vous le revoyiez et le modifiiez si nécessaire.

<img src="/docs/img/git-commit-generation/git-commit-1.png" alt="Generated commit message example" width="600" />

### Format de Commit Conventionnel

Par défaut, les messages générés suivent la spécification Conventional Commits :

```
<type>(<scope>): <description>

<body>
```

Types courants incluant :

- `feat`: Nouvelles fonctionnalités
- `fix`: Corrections de bugs
- `docs`: Changements de documentation
- `style`: Changements de style de code (formatage, etc.)
- `refactor`: Refactoring de code
- `test`: Ajout ou mise à jour de tests
- `chore`: Tâches de maintenance

## Configuration

### Personnaliser le Modèle de Commit

Vous pouvez personnaliser la façon dont les messages de commit sont générés en modifiant le modèle de prompt :

1. Ouvrez les Paramètres en cliquant sur l'icône engrenage <Codicon name="gear" /> → `Prompts`
2. Trouvez la section "Génération de Message de Commit"
3. Éditez le modèle `Prompt` pour correspondre aux conventions de votre projet

<img src="/docs/img/git-commit-generation/git-commit-2.png" alt="Commit message generation settings" width="600" />

Le modèle par défaut crée des messages de commit conventionnels, mais vous pouvez le modifier pour :

- Utiliser différents formats de message de commit
- Inclure des informations spécifiques pertinentes pour votre projet
- Suivre les conventions de message de commit de votre équipe
- Ajouter des instructions personnalisées pour l'IA

### Configuration API

Vous pouvez configurer quel profil API utiliser pour la génération de messages de commit :

1. Dans les paramètres `Prompts`, faites défiler jusqu'à "Configuration API"
2. Sélectionnez un profil spécifique ou utilisez celui actuellement sélectionné

:::tip
Envisagez de créer un [profil de configuration API](/features/api-configuration-profiles) dédié avec un modèle plus rapide et plus rentable spécifiquement pour la génération de messages de commit.
:::

## Bonnes Pratiques

### Stratégie de Staging

- Stagez les changements connexes ensemble pour des messages de commit plus cohérents
- Évitez de stager des changements non liés dans un seul commit
- Utilisez `git add -p` pour le staging partiel de fichiers lorsque nécessaire

### Revue de Message

- Revoyez toujours les messages générés avant de committer
- Éditez les messages pour ajouter du contexte que l'IA pourrait avoir manqué
- Assurez-vous que le message décrit précisément les changements

### Modèles Personnalisés

- Adaptez le modèle de prompt aux besoins de votre projet
- Incluez la terminologie ou les conventions spécifiques au projet
- Ajoutez des instructions pour gérer des types spécifiques de changements

## Exemples de Messages Générés

Voici des exemples de messages que la fonctionnalité pourrait générer :

```
feat(auth): ajouter l'intégration OAuth2 avec Google

Implémenter le flux d'authentification Google OAuth2 incluant :
- Configuration du client OAuth2
- Récupération du profil utilisateur
- Mécanisme de rafraîchissement de token
```

```
fix(api): résoudre la condition de course dans la récupération des données utilisateur

Ajouter une gestion d'erreurs appropriée et une logique de retry pour empêcher
les requêtes concurrentes de causer une incohérence des données
```

```
docs(readme): mettre à jour les instructions d'installation

Ajouter les exigences de dépendances manquantes et clarifier
les étapes de configuration pour les nouveaux contributeurs
```

## Dépannage

### Aucun Changement Staged

Si le bouton n'apparaît pas ou que la génération échoue, assurez-vous d'avoir des changements staged :

```bash
git add <fichiers>
# ou stagez tous les changements
git add .
```

### Qualité de Message Médiocre

Si les messages générés ne sont pas utiles :

- Revoyez votre stratégie de staging - ne stagez pas des changements non liés ensemble
- Personnalisez le modèle de prompt avec des instructions plus spécifiques
- Essayez un modèle IA différent via la configuration API

### Problèmes d'Intégration

La fonctionnalité s'intègre avec la fonctionnalité git intégrée de VS Code. Si vous rencontrez des problèmes :

- Assurez-vous que votre dépôt est correctement initialisé
- Vérifiez que VS Code peut accéder à votre dépôt git
- Vérifiez que git est installé et accessible depuis VS Code

## Fonctionnalités Connexes

- [Profils de Configuration API](/features/api-configuration-profiles) - Utilisez différents modèles pour la génération de commits
- [Gestion des Paramètres](/features/settings-management) - Gérez toutes vos préférences Kilo Code
