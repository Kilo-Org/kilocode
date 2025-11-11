# new_task

L'outil `new_task` crée des sous-tâches avec des modes spécialisés tout en maintenant une relation parent-enfant. Il décompose les projets complexes en pièces gérables, chacune opérant dans le mode le mieux adapté pour un travail spécifique.

## Paramètres

L'outil accepte ces paramètres :

- `mode` (requis) : Le slug du mode pour démarrer la nouvelle tâche (par ex., "code", "ask", "architect")
- `message` (requis) : Le message utilisateur initial ou les instructions pour cette nouvelle tâche

## Ce qu'il fait

Cet outil crée une nouvelle instance de tâche avec un mode de démarrage spécifié et un message initial. Il permet aux flux de travail complexes d'être divisés en sous-tâches avec leur propre historique de conversation. Les tâches parent sont suspendues pendant l'exécution de sous-tâche et reprenues quand la sous-tâche se complète, avec les résultats transférés au parent.

## Quand est-il utilisé ?

- Quand on décompose des projets complexes en sous-tâches séparées et focalisées
- Quand différents aspects d'une tâche requièrent différents modes spécialisés
- Quand différentes phases de travail bénéficient de la séparation de contexte
- Quand on organise des flux de travail de développement multi-phases

## Fonctionnalités Clés

- Crée des sous-tâches avec leur propre historique de conversation et mode spécialisé
- Suspend les tâches parent pour une reprise ultérieure
- Maintient les relations hiérarchiques de tâches pour la navigation
- Transfère les résultats aux tâches parent à la complétion
- Supporte la ségrégation de flux de travail pour des projets complexes
- Permet à différentes parties d'un projet d'utiliser des modes optimisés pour un travail spécifique
- Requiert l'approbation explicite de l'utilisateur pour la création de tâche
- Fournit une transition de tâche claire dans l'UI

## Limitations

- Ne peut pas créer de tâches avec des modes qui n'existent pas
- Requiert l'approbation de l'utilisateur avant de créer chaque nouvelle tâche
- L'interface de tâche peut devenir complexe avec des sous-tâches profondément imbriquées
- Les sous-tâches héritent de certaines configurations d'espace de travail et d'extension des parents
- Peut requérir de ré-établir le contexte lors du basculement entre des tâches profondément imbriquées
- La complétion de tâche a besoin d'un signalisation explicite pour retourner proprement aux tâches parent

## Comment ça fonctionne

Quand l'outil `new_task` est invoqué, il suit ce processus :

1. **Validation de Paramètre** :

    - Valide les paramètres `mode` et `message` requis
    - Vérifie que le mode demandé existe dans le système

2. **Gestion de Pile de Tâches** :

    - Maintient une pile de tâches qui suit toutes les tâches actives et suspendues
    - Préserve le mode actuel pour une reprise ultérieure
    - Met la tâche parent en état suspendu

3. **Gestion de Contexte de Tâche** :

    - Crée un nouveau contexte de tâche avec le message fourni
    - Assigne des identifiants taskId et instanceId uniques pour la gestion d'état
    - Capture les données de télémétrie sur l'utilisation d'outil et les cycles de vie de tâches

4. **Basculement de Mode et Intégration** :

    - Bascule vers le mode spécifié avec rôle et capacités appropriées
    - Initialise la nouvelle tâche avec le message fourni
    - S'intègre avec la palette de commandes de VS Code et les actions de code

5. **Complétion de Tâche et Transfert de Résultats** :
    - Quand la sous-tâche se complète, le résultat est passé à la tâche parent via `finishSubTask()`
    - La tâche parent reprend dans son mode original
    - L'historique de tâche et les métriques d'utilisation de tokens sont mis à jour
    - L'événement `taskCompleted` est émis avec des données de performance

## Exemples d'Utilisation

- Quand un développeur front-end a besoin d'architeter une nouvelle fonctionnalité, implémenter le code, et le documenter, ils peuvent créer des tâches séparées pour chaque phase avec des résultats circulant d'une phase à la suivante.
- Quand on débogue un problème avant d'implémenter un correctif, la tâche de débogage peut documenter les découvertes qui sont passées à la tâche d'implémentation.
- Quand on développe une application full-stack, les conceptions de schéma de base de données d'une tâche mode-architect informent les détails d'implémentation dans une tâche mode-code ultérieure.
- Quand on documente un système après l'implémentation, la tâche de documentation peut faire référence à l'implémentation complétée tout en utilisant des fonctionnalités spécifiques à la documentation.

## Exemples d'Usage

Créer une nouvelle tâche en mode code :

```
<new_task>
<mode>code</mode>
<message>Implementer un service d'authentification utilisateur avec fonctionnalités de connexion, inscription, et réinitialisation de mot de passe.</message>
</new_task>
```

Créer une tâche de documentation après avoir complété l'implémentation :

```
<new_task>
<mode>docs</mode>
<message>Créer une documentation API complète pour le service d'authentification que nous venons de construire.</message>
</new_task>
```

Décomposer une fonctionnalité complexe en planification architecturale et implémentation :

```
<new_task>
<mode>architect</mode>
<message>Concevoir le schéma de base de données et l'architecture système pour notre nouvelle plateforme e-commerce.</message>
</new_task>
```
