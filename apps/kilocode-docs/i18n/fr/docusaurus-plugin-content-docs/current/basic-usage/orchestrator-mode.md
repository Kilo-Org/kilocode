---
sidebar_label: "Mode Orchestrateur"
---

import YouTubeEmbed from '@site/src/components/YouTubeEmbed';

# Mode Orchestrateur : Coordonnez des workflows complexes

Le Mode Orchestrateur (anciennement connu sous le nom de Tâches Boomerang) vous permet de décomposer des projets complexes en parties plus petites et gérables. Pensez-y comme déléguer des parties de votre travail à des assistants spécialisés. Chaque sous-tâche s'exécute dans son propre contexte, utilisant souvent un mode Kilo Code différent adapté à ce travail spécifique (comme [`code`](/basic-usage/using-modes#code-mode-default), [`architect`](/basic-usage/using-modes#architect-mode), ou [`debug`](/basic-usage/using-modes#debug-mode)).

<YouTubeEmbed
  url="https://www.youtube.com/watch?v=20MmJNeOODo"
  caption="Mode Orchestrateur expliqué et démontré"
/>

## Pourquoi utiliser le Mode Orchestrateur ?

- **Aborder la complexité :** Décomposez des projets volumineux et multi-étapes (par exemple, construire une fonctionnalité complète) en sous-tâches focalisées (par exemple, conception, implémentation, documentation).
- **Utiliser des modes spécialisés :** Déléguer automatiquement les sous-tâches au mode le mieux adapté à ce travail spécifique, en exploitant des capacités spécialisées pour des résultats optimaux.
- **Maintenir la concentration et l'efficacité :** Chaque sous-tâche opère dans son propre contexte isolé avec un historique de conversation séparé. Cela empêche la tâche parente (orchestrateur) d'encombrer avec les étapes d'exécution détaillées (comme les diffs de code ou les résultats d'analyse de fichiers), lui permettant de se concentrer efficacement sur le workflow de haut niveau et de gérer le processus global basé sur des résumés concis des sous-tâches terminées.
- **Fluidifier les workflows :** Les résultats d'une sous-tâche peuvent être automatiquement transmis à la suivante, créant un flux fluide (par exemple, les décisions architecturales alimentant la tâche de codage).

## Comment ça fonctionne

1.  En utilisant le Mode Orchestrateur, Kilo peut analyser une tâche complexe et suggérer de la décomposer en une sous-tâche[^1].
2.  La tâche parente se met en pause, et la nouvelle sous-tâche commence dans un mode différent[^2].
3.  Lorsque l'objectif de la sous-tâche est atteint, Kilo signale la completion.
4.  La tâche parente reprend avec uniquement le résumé[^3] de la sous-tâche. Le parent utilise ce résumé pour continuer le workflow principal.

## Considérations clés

- **Approbation requise :** Par défaut, vous devez approuver la création et la completion de chaque sous-tâche. Cela peut être automatisé via les paramètres [Actions auto-approuvées](/features/auto-approving-actions#subtasks) si souhaité.
- **Isolation et transfert de contexte :** Chaque sous-tâche opère dans un isolement complet avec son propre historique de conversation. Elle n'hérite pas automatiquement du contexte du parent. Les informations doivent être explicitement transmises :
    - **Vers le bas :** Via les instructions initiales fournies lors de la création de la sous-tâche.
    - **Vers le haut :** Via le résumé final fourni lorsque la sous-tâche se termine. Soyez conscient que seul ce résumé retourne au parent.
- **Navigation :** L'interface de Kilo vous aide à voir la hiérarchie des tâches (quelle tâche est le parent, lesquelles sont les enfants). Vous pouvez généralement naviguer entre les tâches actives et en pause.

Le Mode Orchestrateur fournit un moyen puissant de gérer des workflows de développement complexes directement dans Kilo Code, en exploitant des modes spécialisés pour une efficacité maximale.

:::tip Gardez les tâches focalisées
Utilisez les sous-tâches pour maintenir la clarté. Si une demande change significativement de focus ou nécessite une expertise différente (mode), envisagez de créer une sous-tâche plutôt que de surcharger la tâche actuelle.
:::

[^1]: Ce contexte est transmis via le paramètre `message` de l'outil [`new_task`](/features/tools/new-task).

[^2]: Le mode pour la sous-tâche est spécifié via le paramètre `mode` de l'outil [`new_task`](/features/tools/new-task) lors de l'initiation.

[^3]: Ce résumé est transmis via le paramètre `result` de l'outil [`attempt_completion`](/features/tools/attempt-completion) lorsque la sous-tâche se termine.
