# Vue d'Ensemble de l'Utilisation d'Outils

Kilo Code implémente un système d'outils sophistiqué qui permet aux modèles d'IA d'interagir avec votre environnement de développement de manière contrôlée et sécurisée. Ce document explique comment les outils fonctionnent, quand ils sont appelée, et comment ils sont gérés.

## Concepts de Base

### Groupes d'Outils

Les outils sont organisés en groupes logiques basés sur leur fonctionnalité :

| Catégorie             | Objectif                                    | Outils                                                                                                                                                                                                                                                           | Usage Courant                                                |
| --------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| **Groupe Lecture**    | Lecture et recherche de système de fichiers | [read_file](/features/tools/read-file), [search_files](/features/tools/search-files), [list_files](/features/tools/list-files), [list_code_definition_names](/features/tools/list-code-definition-names)                                                         | Exploration et analyse de code                               |
| **Groupe Édition**    | Modifications de système de fichiers        | [apply_diff](/features/tools/apply-diff), [write_to_file](/features/tools/write-to-file)                                                                                                                                                                         | Changements de code et manipulation de fichiers              |
| **Groupe Navigateur** | Automatisation web                          | [browser_action](/features/tools/browser-action)                                                                                                                                                                                                                 | Test et interaction web                                      |
| **Groupe Commande**   | Exécution de commandes système              | [execute_command](/features/tools/execute-command)                                                                                                                                                                                                               | Exécution de scripts, construction de projets                |
| **Groupe MCP**        | Intégration d'outils externes               | [use_mcp_tool](/features/tools/use-mcp-tool), [access_mcp_resource](/features/tools/access-mcp-resource)                                                                                                                                                         | Fonctionnalités spécialisées à travers des serveurs externes |
| **Groupe Workflow**   | Gestion de Mode et de tâches                | [switch_mode](/features/tools/switch-mode), [new_task](/features/tools/new-task), [ask_followup_question](/features/tools/ask-followup-question), [attempt_completion](/features/tools/attempt-completion), [update_todo_list](/features/tools/update-todo-list) | Changement de contexte et organisation de tâches             |

### Outils Toujours Disponibles

Certains outils sont accessibles indépendamment du Mode actuel :

- [ask_followup_question](/features/tools/ask-followup-question) : Rassembler des informations additionnelles des utilisateurs
- [attempt_completion](/features/tools/attempt-completion) : Signaler l'achèvement de tâche
- [switch_mode](/features/tools/switch-mode) : Changer les Modes opérationnels
- [new_task](/features/tools/new-task) : Créer des sous-tâches
- [update_todo_list](/features/tools/update-todo-list) : Gérer le suivi de tâches étape par étape

## Outils Disponibles

### Outils de Lecture

Ces outils aident Kilo Code à comprendre votre code et projet :

- [read_file](/features/tools/read-file) - Examine le contenu des fichiers
- [search_files](/features/tools/search-files) - Trouve des motifs à travers plusieurs fichiers
- [list_files](/features/tools/list-files) - Mappe la structure de fichiers de votre projet
- [list_code_definition_names](/features/tools/list-code-definition-names) - Crée une carte structurelle de votre code

### Outils d'Édition

Ces outils aident Kilo Code à faire des changements à votre code :

- [apply_diff](/features/tools/apply-diff) - Effectue des modifications précises et chirurgicales à votre code
- [write_to_file](/features/tools/write-to-file) - Crée de nouveaux fichiers ou réécrit complètement les existants

### Outils de Navigateur

Ces outils aident Kilo Code à interagir avec les applications web :

- [browser_action](/features/tools/browser-action) - Automatise les interactions de navigateur

### Outils de Commande

Ces outils aident Kilo Code à exécuter des commandes :

- [execute_command](/features/tools/execute-command) - Exécute des commandes et programmes système

### Outils MCP

Ces outils aident Kilo Code à se connecter avec des services externes :

- [use_mcp_tool](/features/tools/use-mcp-tool) - Utilise des outils externes spécialisés
- [access_mcp_resource](/features/tools/access-mcp-resource) - Accède aux sources de données externes

### Outils de Workflow

Ces outils aident à gérer la conversation et le flux de tâche :

- [ask_followup_question](/features/tools/ask-followup-question) - Obtient des informations additionnelles de vous
- [attempt_completion](/features/tools/attempt-completion) - Présente les résultats finaux
- [switch_mode](/features/tools/switch-mode) - Change vers un Mode différent pour des tâches spécialisées
- [new_task](/features/tools/new-task) - Crée une nouvelle sous-tâche
- [update_todo_list](/features/tools/update-todo-list) - Suit le progrès de tâche avec des checklists étape par étape

## Mécanisme d'Appel d'Outils

### Quand les Outils Sont-Appelés

Les outils sont invoqués sous des conditions spécifiques :

1. **Exigences Directes de Tâche**

    - Quand des actions spécifiques sont nécessaires pour compléter une tâche comme décidé par le LLM
    - En réponse aux requêtes utilisateur
    - Pendant les workflows automatisés

2. **Disponibilité Basée sur Mode**

    - Différents Modes activent différents ensembles d'outils
    - Les changements de Mode peuvent déclencher des changements de disponibilité d'outils
    - Certains outils sont restreints à des Modes spécifiques

3. **Appels Dépendants du Contexte**
    - Basé sur l'état actuel de l'espace de travail
    - En réponse aux événements système
    - Pendant la gestion d'erreur et la récupération

### Processus de Décision

Le système utilise un processus multi-étapes pour déterminer la disponibilité d'outils :

1. **Validation de Mode**

    ```typescript
    isToolAllowedForMode(
        tool: string,
        modeSlug: string,
        customModes: ModeConfig[],
        toolRequirements?: Record<string, boolean>,
        toolParams?: Record<string, any>
    )
    ```

2. **Vérification d'Exigences**

    - Vérification de capacité système
    - Disponibilité de ressources
    - Validation de permissions

3. **Validation de Paramètres**
    - Présence de paramètres requis
    - Vérification de type de paramètre
    - Validation de valeur

## Implémentation Technique

### Traitement d'Appel d'Outils

1. **Initialisation**

    - Le nom d'outil et les paramètres sont validés
    - La compatibilité de Mode est vérifiée
    - Les exigences sont vérifiées

2. **Exécution**

    ```typescript
    const toolCall = {
    	type: "tool_call",
    	name: chunk.name,
    	arguments: chunk.input,
    	callId: chunk.callId,
    }
    ```

3. **Gestion de Résultats**
    - Détermination de succès/échec
    - Formatage de résultats
    - Gestion d'erreurs

### Sécurité et Permissions

1. **Contrôle d'Accès**

    - Restrictions de système de fichiers
    - Limitations d'exécution de commandes
    - Contrôles d'accès réseau

2. **Couches de Validation**
    - Validation spécifique à l'outil
    - Restrictions basées sur Mode
    - Vérifications au niveau système

## Intégration de Mode

### Accès d'Outils Basé sur Mode

Les outils sont rendus disponibles basés sur le Mode actuel :

- **Mode Code** : Accès complet aux outils de système de fichiers, capacités d'édition de code, exécution de commandes
- **Mode Ask** : Limité aux outils de lecture, capacités de collecte d'informations, pas de modifications de système de fichiers
- **Mode Architect** : Outils axés sur le design, capacités de documentation, droits d'exécution limités
- **Modes Personnalisés** : Peuvent être configurés avec un accès d'outils spécifique pour des workflows spécialisés

### Changement de Mode

1. **Processus**

    - Préservation d'état de Mode actuel
    - Mises à jour de disponibilité d'outils
    - Changement de contexte

2. **Impact sur les Outils**
    - Changements d'ensemble d'outils
    - Ajustements de permissions
    - Préservation de contexte

## Meilleures Pratiques

### Directives d'Utilisation d'Outils

1. **Efficacité**

    - Utiliser l'outil le plus spécifique pour la tâche
    - Éviter les appels d'outils redondants
    - Grouper les opérations quand possible

2. **Sécurité**

    - Valider les entrées avant les appels d'outils
    - Utiliser les permissions minimum requises
    - Suivre les meilleures pratiques de sécurité

3. **Gestion d'Erreurs**
    - Implémenter une vérification d'erreur appropriée
    - Fournir des messages d'erreur significatifs
    - Gérer les échecs gracieusement

### Motifs Communs

1. **Collecte d'Informations**

    ```
    [ask_followup_question](/features/tools/ask-followup-question) → [read_file](/features/tools/read-file) → [search_files](/features/tools/search-files)
    ```

2. **Modification de Code**

    ```
    [read_file](/features/tools/read-file) → [apply_diff](/features/tools/apply-diff) → [attempt_completion](/features/tools/attempt-completion)
    ```

3. **Gestion de Tâche**

    ```
    [new_task](/features/tools/new-task) → [switch_mode](/features/tools/switch-mode) → [execute_command](/features/tools/execute-command)
    ```

4. **Suivi de Progrès**
    ```
    [update_todo_list](/features/tools/update-todo-list) → [execute_command](/features/tools/execute-command) → [update_todo_list](/features/tools/update-todo-list)
    ```

## Gestion d'Erreur et Récupération

### Types d'Erreurs

1. **Erreurs Spécifiques aux Outils**

    - Échecs de validation de paramètres
    - Erreurs d'exécution
    - Problèmes d'accès à ressources

2. **Erreurs Système**

    - Permission refusée
    - Ressource indisponible
    - Échecs réseau

3. **Erreurs de Contexte**
    - Mode invalide pour l'outil
    - Exigences manquantes
    - Inconsistances d'état

### Stratégies de Récupération

1. **Récupération Automatique**

    - Mécanismes de retry
    - Options de fallback
    - Restauration d'état

2. **Intervention Utilisateur**
    - Notifications d'erreur
    - Suggestions de récupération
    - Options d'intervention manuelle
