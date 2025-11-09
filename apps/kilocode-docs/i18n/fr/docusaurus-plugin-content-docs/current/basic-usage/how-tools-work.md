# Fonctionnement des outils

Kilo Code utilise des outils pour interagir avec votre code et votre environnement. Ces assistants spécialisés effectuent des actions spécifiques comme la lecture de fichiers, la modification de code, l'exécution de commandes ou la recherche dans votre base de code. Les outils fournissent une automatisation pour les tâches de développement courantes sans nécessiter d'exécution manuelle.

## Flux de travail des outils

Décrivez ce que vous souhaitez accomplir en langage naturel, et Kilo Code va :

1. Sélectionner l'outil approprié en fonction de votre demande
2. Présenter l'outil avec ses paramètres pour votre validation
3. Exécuter l'outil approuvé et vous montrer les résultats
4. Continuer ce processus jusqu'à ce que votre tâche soit terminée

## Catégories d'outils

| Catégorie       | Objectif                                                   | Noms des outils                                                          |
| :-------------- | :--------------------------------------------------------- | :----------------------------------------------------------------------- |
| Lecture         | Accéder au contenu des fichiers et à la structure du code  | `read_file`, `search_files`, `list_files`, `list_code_definition_names`  |
| Modification    | Créer ou modifier des fichiers et du code                  | `write_to_file`, `apply_diff`                                            |
| Exécution       | Exécuter des commandes et effectuer des opérations système | `execute_command`                                                        |
| Navigateur      | Interagir avec le contenu web                              | `browser_action`                                                         |
| Flux de travail | Gérer le flux des tâches et le contexte                    | `ask_followup_question`, `attempt_completion`, `switch_mode`, `new_task` |

## Exemple : Utilisation des outils

Voici comment fonctionne une interaction typique avec les outils :

<img src="/docs/img/how-tools-work/how-tools-work.png" alt="Interface d'approbation d'outil montrant les boutons Sauvegarder et Rejeter ainsi que la case à cocher Approuver automatiquement" width="600" />

_L'interface d'approbation d'outil affiche les boutons Sauvegarder/Rejeter et les options d'approbation automatique._

**Utilisateur :** Créez un fichier nommé `greeting.js` qui affiche un message de salutation

**Kilo Code :** (Propose l'outil `write_to_file` comme montré dans l'image ci-dessus)

```xml
<write_to_file>
<path>greeting.js</path>
<content>
function greet(name) {
  console.log(`Hello, ${name}!`);
}

greet('World');
</content>
<line_count>5</line_count>
</write_to_file>
```

**Utilisateur :** (Clique sur "Sauvegarder" dans l'interface)

**Kilo Code :** (Confirme la création du fichier)

## Sécurité et approbation des outils

Chaque utilisation d'outil nécessite votre approbation explicite. Lorsque Kilo propose un outil, vous verrez :

- Un bouton "Sauvegarder" pour approuver et exécuter l'outil
- Un bouton "Rejeter" pour décliner l'outil proposé
- Un paramètre optionnel "Approuver automatiquement" pour les opérations de confiance

Ce mécanisme de sécurité garantit que vous conservez le contrôle sur les fichiers modifiés, les commandes exécutées et la manière dont votre base de code est modifiée. Examinez toujours attentivement les propositions d'outils avant de les sauvegarder.

## Référence des outils principaux

| Nom de l'outil               | Description                                                               | Catégorie       |
| :--------------------------- | :------------------------------------------------------------------------ | :-------------- |
| `read_file`                  | Lit le contenu d'un fichier avec numéros de ligne                         | Lecture         |
| `search_files`               | Recherche du texte ou des motifs regex dans plusieurs fichiers            | Lecture         |
| `list_files`                 | Liste les fichiers et répertoires à un emplacement spécifié               | Lecture         |
| `list_code_definition_names` | Liste les définitions de code comme les classes et fonctions              | Lecture         |
| `write_to_file`              | Crée de nouveaux fichiers ou écrase des fichiers existants                | Modification    |
| `apply_diff`                 | Apporte des modifications précises à des parties spécifiques d'un fichier | Modification    |
| `execute_command`            | Exécute des commandes dans le terminal VS Code                            | Exécution       |
| `browser_action`             | Effectue des actions dans un navigateur headless                          | Navigateur      |
| `ask_followup_question`      | Vous pose une question de clarification                                   | Flux de travail |
| `attempt_completion`         | Indique que la tâche est terminée                                         | Flux de travail |
| `switch_mode`                | Change vers un mode opérationnel différent                                | Flux de travail |
| `new_task`                   | Crée une nouvelle sous-tâche avec un mode de démarrage spécifique         | Flux de travail |

## En savoir plus sur les outils

Pour des informations plus détaillées sur chaque outil, y compris les références complètes des paramètres et les patterns d'utilisation avancés, consultez la documentation [Aperçu de l'utilisation des outils](/features/tools/tool-use-overview).
