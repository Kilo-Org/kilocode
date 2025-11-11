# Mentions de Contexte

Les mentions de contexte sont un moyen puissant de fournir à Kilo Code des informations spécifiques sur votre projet, lui permettant d'effectuer des tâches plus précisément et efficacement. Vous pouvez utiliser les mentions pour faire référence à des fichiers, dossiers, problèmes et commits Git. Les mentions de contexte commencent par le symbole `@`.

<img src="/docs/img/context-mentions/context-mentions.png" alt="Context Mentions Overview - showing the @ symbol dropdown menu in the chat interface" width="600" />

_Vue d'ensemble des mentions de contexte montrant le menu déroulant du symbole @ dans l'interface de chat._

## Types de Mentions

<img src="/docs/img/context-mentions/context-mentions-1.png" alt="File mention example showing a file being referenced with @ and its contents appearing in the conversation" width="600" />

_Les mentions de fichiers ajoutent le contenu de code réel dans la conversation pour référence et analyse directes._

| Type de Mention     | Format                 | Description                                                 | Exemple d'Utilisation                                |
| ------------------- | ---------------------- | ----------------------------------------------------------- | ---------------------------------------------------- |
| **Fichier**         | `@/path/to/file.ts`    | Inclut le contenu du fichier dans le contexte de la requête | "Explique la fonction dans @/src/utils.ts"           |
| **Dossier**         | `@/path/to/folder/`    | Fournit la structure du répertoire au format arborescent    | "Quels fichiers sont dans @/src/components/ ?"       |
| **Problèmes**       | `@problems`            | Inclut les diagnostics du panneau Problèmes VS Code         | "@problems Corrige toutes les erreurs dans mon code" |
| **Terminal**        | `@terminal`            | Inclut la commande et la sortie de terminal récentes        | "Corrige les erreurs montrées dans @terminal"        |
| **Commit Git**      | `@a1b2c3d`             | Référence un commit spécifique par son hash                 | "Qu'est-ce qui a changé dans le commit @a1b2c3d ?"   |
| **Changements Git** | `@git-changes`         | Affiche les changements non commités                        | "Suggère un message pour @git-changes"               |
| **URL**             | `@https://example.com` | Importe le contenu du site web                              | "Résume @https://docusaurus.io/"                     |

### Mentions de Fichiers

<img src="/docs/img/context-mentions/context-mentions-1.png" alt="File mention example showing a file being referenced with @ and its contents appearing in the conversation" width="600" />

_Les mentions de fichiers incorporent le code source avec numéros de ligne pour des références précises._
| Capacité | Détails |
|------------|---------|
| **Format** | `@/path/to/file.ts` (commence toujours par `/` depuis la racine de l'espace de travail) |
| **Fournit** | Contenu complet du fichier avec numéros de ligne |
| **Prend en charge** | Fichiers texte, PDF et DOCX (avec extraction de texte) |
| **Fonctionne dans** | Requêtes initiales, réponses de feedback et messages de suivi |
| **Limitations** | Les très gros fichiers peuvent être tronqués ; fichiers binaires non pris en charge |

### Mentions de Dossiers

<img src="/docs/img/context-mentions/context-mentions-2.png" alt="Folder mention example showing directory contents being referenced in the chat" width="600" />

_Les mentions de dossiers affichent la structure du répertoire dans un format arborescent lisible._
| Capacité | Détails |
|------------|---------|
| **Format** | `@/path/to/folder/` (notez la barre oblique finale) |
| **Fournit** | Affichage arborescent hiérarchique avec préfixes ├── et └── |
| **Inclut** | Fichiers et répertoires enfants immédiats (non récursif) |
| **Idéal pour** | Comprendre la structure du projet |
| **Conseil** | Utilisez avec des mentions de fichiers pour vérifier le contenu de fichiers spécifiques |

### Mention de Problèmes

<img src="/docs/img/context-mentions/context-mentions-3.png" alt="Problems mention example showing VS Code problems panel being referenced with @problems" width="600" />

_Les mentions de problèmes importent les diagnostics directement depuis le panneau de problèmes VS Code._
| Capacité | Détails |
|------------|---------|
| **Format** | `@problems` |
| **Fournit** | Toutes les erreurs et avertissements du panneau de problèmes VS Code |
| **Inclut** | Chemins de fichiers, numéros de ligne et messages de diagnostic |
| **Regroupe** | Problèmes organisés par fichier pour meilleure clarté |
| **Idéal pour** | Corriger les erreurs sans copier manuellement |

### Mention de Terminal

<img src="/docs/img/context-mentions/context-mentions-4.png" alt="Terminal mention example showing terminal output being included in Kilo Code's context" width="600" />

_Les mentions de terminal capturent la sortie de commande récente pour le débogage et l'analyse._

| Capacité       | Détails                                                         |
| -------------- | --------------------------------------------------------------- |
| **Format**     | `@terminal`                                                     |
| **Capture**    | Dernière commande et sa sortie complète                         |
| **Préserve**   | État du terminal (ne vide pas le terminal)                      |
| **Limitation** | Limité au contenu visible du tampon terminal                    |
| **Idéal pour** | Déboguer les erreurs de build ou analyser la sortie de commande |

### Mentions Git

<img src="/docs/img/context-mentions/context-mentions-5.png" alt="Git commit mention example showing commit details being analyzed by Kilo Code" width="600" />

_Les mentions Git fournissent des détails de commit et des diffs pour l'analyse de version consciente du contexte._
| Type | Format | Fournit | Limitations |
|------|--------|----------|------------|
| **Commit** | `@a1b2c3d` | Message de commit, auteur, date et diff complet | Fonctionne uniquement dans les dépôts Git |
| **Changements en cours** | `@git-changes` | Sortie `git status` et diff des changements non commités | Fonctionne uniquement dans les dépôts Git |

### Mentions URL

<img src="/docs/img/context-mentions/context-mentions-6.png" alt="URL mention example showing website content being converted to Markdown in the chat" width="600" />

_Les mentions URL importent le contenu web externe et le convertissent en format Markdown lisible._

| Capacité       | Détails                                                      |
| -------------- | ------------------------------------------------------------ |
| **Format**     | `@https://example.com`                                       |
| **Traitement** | Utilise un navigateur headless pour récupérer le contenu     |
| **Nettoyage**  | Supprime les scripts, styles et éléments de navigation       |
| **Sortie**     | Convertit le contenu en Markdown pour la lisibilité          |
| **Limitation** | Les pages complexes peuvent ne pas se convertir parfaitement |

## Comment Utiliser les Mentions

1. Tapez `@` dans l'entrée de chat pour déclencher le menu déroulant de suggestions
2. Continuez à taper pour filtrer les suggestions ou utilisez les touches fléchées pour naviguer
3. Sélectionnez avec la touche Entrée ou un clic de souris
4. Combinez plusieurs mentions dans une requête : "Corrige @problems dans @/src/component.ts"

Le menu déroulant suggère automatiquement :

- Fichiers récemment ouverts
- Dossiers visibles
- Commits git récents
- Mots-clés spéciaux (`problems`, `terminal`, `git-changes`)

## Bonnes Pratiques

| Pratique                             | Description                                                                                                 |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| **Utilisez des chemins spécifiques** | Référencez des fichiers exacts plutôt que de les décrire                                                    |
| **Utilisez des chemins relatifs**    | Commencez toujours depuis la racine de l'espace de travail : `@/src/file.ts` pas `@C:/Projects/src/file.ts` |
| **Vérifiez les références**          | Assurez-vous que les chemins et les hashes de commit sont corrects                                          |
| **Cliquez sur les mentions**         | Cliquez sur les mentions dans l'historique de chat pour ouvrir les fichiers ou voir le contenu              |
| **Éliminez le copier-coller**        | Utilisez les mentions au lieu de copier manuellement le code ou les erreurs                                 |
| **Combinez les mentions**            | "Corrige @problems dans @/src/component.ts en utilisant le pattern du commit @a1b2c3d"                      |
