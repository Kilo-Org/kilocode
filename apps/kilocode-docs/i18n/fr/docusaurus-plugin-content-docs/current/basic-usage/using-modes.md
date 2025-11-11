# Utilisation des Modes

Les modes dans Kilo Code sont des personas spécialisés qui adaptent le comportement de l'assistant à votre tâche actuelle. Chaque mode offre des capacités, une expertise et des niveaux d'accès différents pour vous aider à accomplir des objectifs spécifiques.

## Pourquoi utiliser différents modes ?

- **Spécialisation des tâches :** Obtenez précisément le type d'assistance dont vous avez besoin pour votre tâche actuelle
- **Contrôles de sécurité :** Empêchez les modifications de fichiers non intentionnelles lors de la planification ou de l'apprentissage
- **Interactions ciblées :** Recevez des réponses optimisées pour votre activité actuelle
- **Optimisation du workflow :** Transitionnez sans effort entre planification, implémentation, débogage et apprentissage

<YouTubeEmbed
  url="https://youtu.be/cS4vQfX528w"
  caption="Explication des différents modes dans Kilo Code"
/>

## Changement entre les modes

Quatre façons de changer de mode :

1. **Menu déroulant :** Cliquez sur le sélecteur à gauche de la saisie de chat

    <img src="/docs/img/modes/modes.png" alt="Utilisation du menu déroulant pour changer de mode" width="400" />

2. **Commande slash :** Tapez `/architect`, `/ask`, `/debug`, ou `/code` dans la saisie de chat

    <img src="/docs/img/modes/modes-1.png" alt="Utilisation des commandes slash pour changer de mode" width="400" />

3. **Commande de bascule/Raccourci clavier :** Utilisez le raccourci clavier ci-dessous, applicable à votre système d'exploitation. Chaque pression fait défiler les modes disponibles dans l'ordre, en revenant au premier mode après avoir atteint la fin.

    | Système d'exploitation | Raccourci |
    | ---------------------- | --------- |
    | macOS                  | ⌘ + .     |
    | Windows                | Ctrl + .  |
    | Linux                  | Ctrl + .  |

4. **Accepter les suggestions :** Cliquez sur les suggestions de changement de mode que Kilo Code offre lorsque approprié

    <img src="/docs/img/modes/modes-2.png" alt="Acceptation d'une suggestion de changement de mode de Kilo Code" width="400" />

## Modes intégrés

### Mode Code (Défaut)

| Aspect                        | Détails                                                                                                                       |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Description**               | Un ingénieur logiciel qualifié avec une expertise en langages de programmation, patrons de conception et meilleures pratiques |
| **Accès aux outils**          | Accès complet à tous les groupes d'outils : `read`, `edit`, `browser`, `command`, `mcp`                                       |
| **Idéal pour**                | Écrire du code, implémenter des fonctionnalités, déboguer et développement général                                            |
| **Fonctionnalités spéciales** | Aucune restriction d'outils—flexibilité complète pour toutes les tâches de codage                                             |

### Mode Question

| Aspect                        | Détails                                                                                                         |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Description**               | Un assistant technique knowledgeable axé sur répondre aux questions sans changer votre base de code             |
| **Accès aux outils**          | Accès limité : `read`, `browser`, `mcp` uniquement (ne peut pas modifier de fichiers ou exécuter des commandes) |
| **Idéal pour**                | Explication de code, exploration de concepts et apprentissage technique                                         |
| **Fonctionnalités spéciales** | Optimisé pour des réponses informatives sans modifier votre projet                                              |

### Mode Architecte

| Aspect                        | Détails                                                                                                                |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Description**               | Un leader technique et planificateur expérimenté qui aide à concevoir des systèmes et créer des plans d'implémentation |
| **Accès aux outils**          | Accès à `read`, `browser`, `mcp`, et `edit` restreint (fichiers markdown uniquement)                                   |
| **Idéal pour**                | Conception de système, planification de haut niveau et discussions d'architecture                                      |
| **Fonctionnalités spéciales** | Suit une approche structurée de la collecte d'informations à la planification détaillée                                |

### Mode Débogage

| Aspect                        | Détails                                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------------- |
| **Description**               | Un expert en résolution de problèmes spécialisé dans le dépannage systématique et les diagnostics       |
| **Accès aux outils**          | Accès complet à tous les groupes d'outils : `read`, `edit`, `browser`, `command`, `mcp`                 |
| **Idéal pour**                | Traquer les bugs, diagnostiquer les erreurs et résoudre des problèmes complexes                         |
| **Fonctionnalités spéciales** | Utilise une approche méthodique d'analyse, de réduction des possibilités et de correction des problèmes |

### Mode Orchestrateur

| Aspect                        | Détails                                                                                                                       |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Description**               | Un orchestrateur de workflow stratégique qui coordonne des tâches complexes en les déléguant aux modes spécialisés appropriés |
| **Accès aux outils**          | Accès limité pour créer de nouvelles tâches et coordonner des workflows                                                       |
| **Idéal pour**                | Décomposer des projets complexes en sous-tâches gérables assignées à des modes spécialisés                                    |
| **Fonctionnalités spéciales** | Utilise l'outil new_task pour déléguer le travail à d'autres modes                                                            |

## Modes personnalisés

Créez vos propres assistants spécialisés en définissant l'accès aux outils, les permissions de fichiers et les instructions de comportement. Les modes personnalisés aident à faire respecter les normes d'équipe ou à créer des assistants à but spécifique. Consultez la [documentation des Modes personnalisés](/features/custom-modes) pour les instructions de configuration.
