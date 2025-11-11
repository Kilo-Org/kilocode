# Actions d'Auto-Approbation

> ⚠️ **AVERTISSEMENT DE SÉCURITÉ :** Les paramètres d'auto-approbation contournent les invites de confirmation, donnant à Kilo Code un accès direct à votre système. Cela peut entraîner une **perte de données, corruption de fichiers, ou pire**. L'accès en ligne de commande est particulièrement dangereux, car il peut exécuter des opérations nuisibles qui pourraient endommager votre système ou compromettre la sécurité. N'activez l'auto-approbation que pour des actions en lesquelles vous avez entièrement confiance.

Les paramètres d'auto-approbation accélèrent votre flux de travail en éliminant les invites de confirmation répétitives, mais ils augmentent considérablement les risques de sécurité.

## Guide de Démarrage Rapide

1. Cliquez sur la Barre d'Outils Auto-Approbation au-dessus de l'entrée de chat
2. Sélectionnez quelles actions Kilo Code peut effectuer sans demander permission
3. Utilisez l'interrupteur principal (première case à cocher à gauche) pour activer/désactiver rapidement toutes les autorisations

[![Timeline des Tâches KiloCode](https://img.youtube.com/vi/NBccFnYDQ-k/maxresdefault.jpg)](https://youtube.com/shorts/NBccFnYDQ-k?feature=shared)

## Barre d'Outils Auto-Approbation

<img src="/docs/img/auto-approving-actions/auto-approving-actions.png" alt="Barre d'outils d'auto-approbation en état réduit" width="600" />

_Boîte de prompt et Barre d'Outils Auto-Approbation montrant les autorisations activées_

Cliquez sur la barre d'outils pour l'étendre et configurer les autorisations individuelles :

<img src="/docs/img/auto-approving-actions/auto-approving-actions-1.png" alt="Barre d'outils d'auto-approbation en état étendu" width="600" />

_Boîte de texte de prompt et Barre d'outils étendue avec toutes les options_

### Autorisations Disponibles

| Autorisation                           | Ce qu'elle fait                                                     | Niveau de risque |
| -------------------------------------- | ------------------------------------------------------------------- | ---------------- |
| **Lire les fichiers et répertoires**   | Permet à Kilo Code d'accéder aux fichiers sans demander             | Moyen            |
| **Éditer les fichiers**                | Permet à Kilo Code de modifier les fichiers sans demander           | **Élevé**        |
| **Exécuter les commandes approuvées**  | Exécute automatiquement les commandes de terminal sur liste blanche | **Élevé**        |
| **Utiliser le navigateur**             | Permet l'interaction avec un navigateur headless                    | Moyen            |
| **Utiliser les serveurs MCP**          | Permet à Kilo Code d'utiliser les services MCP configurés           | Moyen-Élevé      |
| **Basculer les modes**                 | Change automatiquement entre les modes de Kilo Code                 | Faible           |
| **Créer et compléter les sous-tâches** | Gère les sous-tâches sans confirmation                              | Faible           |
| **Relancer les requêtes échouées**     | Relance automatiquement les requêtes API échouées                   | Faible           |
| **Répondre aux questions de suivi**    | Sélectionne la réponse par défaut pour les questions de suivi       | Faible           |
| **Mettre à jour la liste de tâches**   | Met à jour automatiquement le progrès des tâches                    | Faible           |

## Interrupteur Principal pour Contrôle Rapide

La case à cocher la plus à gauche fonctionne comme un interrupteur principal :

<img src="/docs/img/auto-approving-actions/auto-approving-actions-14.png" alt="Interrupteur principal dans la barre d'outils d'auto-approbation" width="600" />

_Interrupteur principal (case à cocher) contrôle toutes les autorisations d'auto-approbation d'un coup_

Utilisez l'interrupteur principal quand :

- Vous travaillez sur du code sensible (éteindre)
- Vous faites du développement rapide (allumer)
- Vous basculez entre des tâches d'exploration et d'édition

## Panneau de Paramètres Avancés

Le panneau de paramètres fournit un contrôle détaillé avec un contexte de sécurité important :

> **Permettre à Kilo Code d'effectuer automatiquement des opérations sans exiger d'approbation. Activez ces paramètres uniquement si vous faites entièrement confiance à l'IA et comprenez les risques de sécurité associés.**

Pour accéder à ces paramètres :

1. Cliquez sur <Codicon name="gear" /> dans le coin supérieur droit
2. Naviguez vers Paramètres Auto-Approbation

<img src="/docs/img/auto-approving-actions/auto-approving-actions-4.png" alt="Panneau de paramètres avec options d'auto-approbation" width="550" />

_Vue complète du panneau de paramètres_

### Opérations de Lecture

:::caution Opérations de Lecture
<img src="/docs/img/auto-approving-actions/auto-approving-actions-6.png" alt="Paramètre d'opérations en lecture seule" width="550" />

**Paramètre :** "Toujours approuver les opérations en lecture seule"

**Description :** "Quand activé, Kilo Code visualisera automatiquement le contenu des répertoires et lira les fichiers sans vous demander de cliquer sur le bouton Approuver."

**Niveau de risque :** Moyen

Bien que ce paramètre ne permette que de lire des fichiers (pas de les modifier), il pourrait potentiellement exposer des données sensibles. Still recommandé comme point de départ pour la plupart des utilisateurs, mais soyez conscient des fichiers auquel Kilo Code peut accéder.
:::

### Opérations d'Écriture

:::caution Opérations d'Écriture
<img src="/docs/img/auto-approving-actions/auto-approving-actions-7.png" alt="Paramètre d'opérations d'écriture avec curseur de délai" width="550" />

**Paramètre :** "Toujours approuver les opérations d'écriture"

**Description :** "Crée et édite automatiquement des fichiers sans exiger d'approbation"

**Curseur de délai :** "Délai après écritures pour permettre aux diagnostics de détecter les problèmes potentiels" (Par défaut : 1000ms)

**Niveau de risque :** Élevé

Ce paramètre permet à Kilo Code de modifier vos fichiers sans confirmation. Le minuteur de délai est crucial :

- Valeurs plus élevées (2000ms+) : Recommandé pour les projets complexes où les diagnostics prennent plus de temps
- Par défaut (1000ms) : Adapté pour la plupart des projets
- Valeurs plus faibles : Utilisez seulement quand la vitesse est critique et que vous êtes dans un environnement contrôlé
- Zéro : Aucun délai pour les diagnostics (non recommandé pour le code critique)

#### Intégration du Délai d'Écriture et du Panneau Problèmes

<img src="/docs/img/auto-approving-actions/auto-approving-actions-5.png" alt="Panneau VSCode Problèmes montrant les informations de diagnostic" width="600" />

_Panneau VSCode Problèmes que Kilo Code vérifie pendant le délai d'écriture_

Quand vous activez l'auto-approbation pour l'écriture de fichiers, le minuteur de délai fonctionne avec le Panneau Problèmes de VSCode :

1. Kilo Code fait un changement à votre fichier
2. Les outils de diagnostic de VSCode analysent le changement
3. Le Panneau Problèmes se met à jour avec les erreurs ou avertissements
4. Kilo Code remarque ces problèmes avant de continuer

Cela fonctionne comme un développeur humain qui fait une pause pour vérifier les erreurs après avoir changé du code. Vous pouvez ajuster le temps de délai basé sur :

- La complexité du projet
- La vitesse du serveur de langage
- L'importance de la détection d'erreurs pour votre flux de travail
  :::

### Actions de Navigateur

:::info Actions de Navigateur
<img src="/docs/img/auto-approbing-actions/auto-approving-actions-8.png" alt="Paramètre d'actions de navigateur" width="550" />

**Paramètre :** "Toujours approuver les actions de navigateur"

**Description :** "Effectue automatiquement des actions de navigateur sans exiger d'approbation"

**Note :** "S'applique seulement quand le modèle supporte l'utilisation d'ordinateur"

**Niveau de risque :** Moyen

Permet à Kilo Code de contrôler un navigateur headless sans confirmation. Cela peut inclure :

- Ouvrir des sites web
- Naviguer sur les pages
- Interagir avec les éléments web

Considérez les implications de sécurité de permettre l'accès automatisé au navigateur.
:::

### Requêtes API

:::info Requêtes API
<img src="/docs/img/auto-approbing-actions/auto-approving-actions-9.png" alt="Paramètre de relance de requêtes API avec curseur de délai" width="550" />

**Paramètre :** "Toujours relancer les requêtes API échouées"

**Description :** "Relance automatiquement les requêtes API échouées quand le serveur retourne une réponse d'erreur"

**Curseur de délai :** "Délai avant de relancer la requête" (Par défaut : 5s)

**Niveau de risque :** Faible

Ce paramètre relance automatiquement les appels API quand ils échouent. Le délai contrôle combien de temps Kilo Code attend avant de réessayer :

- Les délais plus longs sont plus doux sur les limites de débit API
- Les délais plus courts donnent une récupération plus rapide des erreurs transitoires
  :::

### Outils MCP

:::caution Outils MCP
<img src="/docs/img/auto-approbing-actions/auto-approving-actions-10.png" alt="Paramètre d'outils MCP" width="550" />

**Paramètre :** "Toujours approuver les outils MCP"

**Description :** "Active l'auto-approbation d'outils MCP individuels dans la vue Serveurs MCP (requiert à la fois ce paramètre et la case à cocher 'Toujours autoriser' individuelle de l'outil)"

**Niveau de risque :** Moyen-Élevé (dépend des outils MCP configurés)

Ce paramètre fonctionne conjointement avec les autorisations d'outils individuels dans la vue Serveurs MCP. Tant ce paramètre global que l'autorisation spécifique à l'outil doivent être activés pour l'auto-approbation.
:::

### Basculement de Mode

:::info Basculement de Mode
<img src="/docs/img/auto-approbing-actions/auto-approving-actions-11.png" alt="Paramètre de basculement de mode" width="550" />

**Paramètre :** "Toujours approuver le basculement de mode"

**Description :** "Bascule automatiquement entre différents modes sans exiger d'approbation"

**Niveau de risque :** Faible

Permet à Kilo Code de changer entre différents modes (Code, Architect, etc.) sans demander permission. Cela affecte principalement le comportement de l'IA plutôt que l'accès système.
:::

### Sous-tâches

:::info Sous-tâches
<img src="/docs/img/auto-approbing-actions/auto-approving-actions-12.png" alt="Paramètre de sous-tâches" width="550" />

**Paramètre :** "Toujours approuver la création et la complétion de sous-tâches"

**Description :** "Permet la création et la complétion de sous-tâches sans exiger d'approbation"

**Niveau de risque :** Faible

Permet à Kilo Code de créer et compléter automatiquement des sous-tâches. Cela se rapporte à l'organisation du flux de travail plutôt qu'à l'accès système.
:::

### Exécution de Commandes

:::caution Exécution de Commandes
<img src="/docs/img/auto-approbing-actions/auto-approving-actions-13.png" alt="Paramètre d'exécution de commande avec interface de liste blanche" width="550" />

**Paramètre :** "Toujours approuver les opérations d'exécution autorisées"

**Description :** "Exécute automatiquement les commandes de terminal autorisées sans exiger d'approbation"

**Gestion des commandes :** "Préfixes de commandes qui peuvent être auto-exécutées quand 'Toujours approuver les opérations d'exécution' est activé. Ajoutez \* pour permettre toutes les commandes (utilisez avec prudence)."

**Niveau de risque :** Élevé

Ce paramètre permet l'exécution de commandes de terminal avec des contrôles. Bien que risqué, la fonctionnalité de liste blanche limite quelles commandes peuvent fonctionner. Caractéristiques de sécurité importantes :

- Liste blanche de préfixes de commandes spécifiques (recommandé)
- N'utilisez jamais le caractère générique \* en production ou avec des données sensibles
- Considérez les implications de sécurité de chaque commande autorisée
- Vérifiez toujours les commandes qui interagissent avec des systèmes externes

**Éléments d'interface :**

- Champ de texte pour entrer les préfixes de commandes (ex. 'git')
- Bouton "Ajouter" pour ajouter de nouveaux préfixes
- Boutons de commandes cliquables avec X pour les supprimer
  :::

### Questions de Suivi

:::info Questions de Suivi (Risque : Faible)

**Paramètre :** `Toujours répondre par défaut aux questions de suivi`

**Description :** Sélectionne automatiquement la première réponse suggérée par l'IA pour une question de suivi après un délai configurable. Cela accélère votre flux de travail en permettant à Kilo Code de procéder sans intervention manuelle.

**Compte à rebours visuel :** Quand activé, un minuteur de compte à rebours apparaît sur le premier bouton de suggestion, montrant le temps restant avant la sélection automatique. Le minuteur est affiché comme un indicateur de progrès circulaire qui se vide au fil du temps.

**Curseur de délai :** Utilisez le curseur pour définir le temps d'attente de 1 à 300 secondes (Par défaut : 60s).

**Options de dépassement :** Vous pouvez annuler la sélection automatique à tout moment en :

- Cliquant sur une suggestion différente
- Éditant n'importe quelle suggestion
- Tappant votre propre réponse
- Cliquant sur le minuteur pour le mettre en pause

**Niveau de risque :** Faible

**Cas d'utilisation :**

- Exécutions nocturnes où vous voulez que Kilo Code continue à travailler
- Tâches répétitives où les suggestions par défaut sont généralement correctes
- Test de flux de travail où l'interaction n'est pas critique
  :::

### Mettre à Jour la Liste de Tâches

:::info Mettre à Jour la Liste de Tâches (Risque : Faible)

**Paramètre :** "Toujours approuver les mises à jour de liste de tâches"

**Description :** "Met automatiquement à jour la liste de tâches sans exiger d'approbation"

**Niveau de risque :** Faible

Ce paramètre permet à Kilo Code de mettre automatiquement à jour le progrès des tâches et les listes de tâches pendant les sessions de travail. Cela inclut :

- Marquer les tâches comme complétées
- Ajouter de nouvelles tâches découvertes
- Mettre à jour le statut des tâches (en attente, en cours, complétées)
- Réorganiser les priorités des tâches

**Avantages :**

- Maintient une visibilité du progrès des tâches en temps réel
- Réduit les interruptions pendant les flux de travail multi-étapes
- Garde le statut du projet accurately reflété
- Aide à suivre les dépendances de tâches complexes

**Cas d'utilisation :**

- Sessions de développement de longue durée
- Projets de refactoring multi-étapes
- Flux de travail de débogage complexes
- Implémentation de fonctionnalités avec de nombreuses sous-tâches

Ceci est particulièrement utile combiné avec l'autorisation Sous-tâches, car cela permet à Kilo Code de maintenir une vue complète du progrès du projet sans demandes d'approbation constantes.
:::
